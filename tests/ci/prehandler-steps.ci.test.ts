/**
 * Pre-handler steps on the `route_timing` line — the real middleware, the real timer.
 *
 * @spec [owner brief (Karl) 2026-10-15 "next perf PR" item 1 ("Add per-step timing to the shared
 *        middleware chain in front of these routes ... emitted through the existing
 *        step-timer/route_timing line (fixed literal step names, no content, no tokens/cookies/ids
 *        beyond what route_timing already carries)"); Coding Standards §12.1] | @implemented [2026-10-15]
 *
 * plain English: mounts `requestIdMiddleware` → `supabaseAuthMiddleware` → `requireSupabaseAuth`
 * → a `timedRoute` handler, with only the two IO seams stubbed (the SSR client's `getUser`, which
 * can be told to "refresh" by writing an auth cookie as the real adapter does, and the profile
 * read), and asserts on the exact `route_timing` call: the auth steps are named, ordered, timed and
 * carry nothing else; a refresh is named as one; the line carries no token, cookie, email or id;
 * and the 401 path is unchanged (no user, no handler, no line).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Response } from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import request from "supertest";

const TOKEN = "sb-access-token-SECRET-VALUE";
const EMAIL = "prehandler@example.com";
const USER_ID = "4a4a4a4a-0000-4000-8000-000000000001";

const info = vi.fn();
vi.mock("../../server/logger", () => ({
  logger: {
    info,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    apiRequest: vi.fn(),
  },
}));

const state = { signedIn: true, refresh: false, authMs: 15, profileMs: 10 };
const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

vi.mock("../../server/lib/supabase-ssr", () => ({
  createSupabaseServerClient: (_req: unknown, res: Response) => ({
    auth: {
      getUser: async () => {
        await pause(state.authMs);
        if (state.refresh) {
          // What the real cookie adapter does when getUser refreshed the session.
          res.cookie("sb-ref-auth-token", "refreshed-cookie-SECRET");
        }
        return state.signedIn
          ? { data: { user: { id: USER_ID, email: EMAIL } }, error: null }
          : { data: { user: null }, error: null };
      },
    },
  }),
}));

vi.mock("../../server/lib/profile-bootstrap", () => ({
  AccountEmailConflictError: class AccountEmailConflictError extends Error {},
  UnrecognizedRoleError: class UnrecognizedRoleError extends Error {},
  ensureProfileForAuthUser: async () => {
    await pause(state.profileMs);
    return {
      id: USER_ID,
      email: EMAIL,
      display_name: "Pre Handler",
      role: "student",
      is_under_13: false,
      profile_completed_at: "2026-09-01T00:00:00.000Z",
      student_link_code: null,
      actor_id: "4a4a4a4a-0000-4000-8000-000000000002",
    };
  },
}));

const { requestIdMiddleware } =
  await import("../../server/middleware/request-id");
const { supabaseAuthMiddleware, requireSupabaseAuth } =
  await import("../../server/middleware/supabase-auth");
const { timedRoute, PRE_HANDLER_STEPS } =
  await import("../../server/lib/step-timer");
const { doubleCsrfProtection, generateToken } =
  await import("../../server/middleware/csrf-double-submit");

function app(): express.Express {
  const a = express();
  a.use(requestIdMiddleware);
  a.use(cookieParser());
  a.use("/api", authRateLimiter);
  // The CSRF token bootstrap, as production serves it (server/index.ts `/api/csrf-token`).
  a.get("/api/csrf-token", (req, res) => {
    res.json({ csrfToken: generateToken(req, res) });
  });
  // CSRF: the PRODUCTION middleware (`doubleCsrfProtection`, server/middleware/csrf-double-submit),
  // not a stub. Production mounts it per router, after the session middleware. Here it sits
  // app-level, right after the cookie parser and limiter and BEFORE the session middleware,
  // because the session middleware is itself an app-level handler that reads cookies, and CodeQL
  // (js/missing-token-validation) wants every cookie-reading handler behind CSRF (production's
  // own index.ts carries a dismissal note for that same pattern). For the requests measured here
  // the position costs nothing (an HMAC check, no I/O; GET is exempt); only the PRECEDENCE of two
  // denials differs — a request failing both CSRF and auth sees 403 here, 401 in production — and
  // every request below carries a valid token, so that path is never exercised.
  a.use(doubleCsrfProtection);
  a.use(supabaseAuthMiddleware);
  a.get(
    "/api/timed",
    requireSupabaseAuth,
    timedRoute("calendar.read", async (_req, res) => {
      res.json({ ok: true });
    }),
  );
  a.post(
    "/api/timed",
    requireSupabaseAuth,
    timedRoute("practice.answer_submit", async (_req, res) => {
      res.json({ ok: true });
    }),
  );
  return a;
}

type PreStep = { step: string; ms: number | null; at_ms: number };

function timingLines(): Array<Record<string, unknown>> {
  return info.mock.calls
    .filter((c) => c[0] === "PERF" && c[1] === "route_timing")
    .map((c) => c[3] as Record<string, unknown>);
}

beforeEach(() => {
  info.mockClear();
  state.signedIn = true;
  state.refresh = false;
});

describe("pre-handler steps (route_timing.pre_steps)", () => {
  it("names, orders and times the session and profile steps, inside pre_handler_ms", async () => {
    const res = await request(app())
      .get("/api/timed")
      .set("Cookie", `sb-access-token=${TOKEN}`);
    expect(res.status).toBe(200);

    const lines = timingLines();
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    const steps = line.pre_steps as PreStep[];
    expect(steps.map((s) => s.step)).toEqual(["auth_session", "auth_profile"]);
    for (const s of steps) {
      expect(Object.keys(s).sort()).toEqual(["at_ms", "ms", "step"]);
      expect(PRE_HANDLER_STEPS).toContain(s.step);
    }
    const [session, profile] = steps as [PreStep, PreStep];
    expect(session.ms!).toBeGreaterThanOrEqual(state.authMs - 2);
    expect(profile.ms!).toBeGreaterThanOrEqual(state.profileMs - 2);
    // Sequential: the profile read starts after the session check ends.
    expect(profile.at_ms).toBeGreaterThanOrEqual(
      session.at_ms + session.ms! - 1,
    );
    expect(line.pre_handler_ms as number).toBeGreaterThanOrEqual(
      profile.at_ms + profile.ms! - 1,
    );
  });

  it("names a refreshed session as auth_session_refresh", async () => {
    state.refresh = true;
    const res = await request(app())
      .get("/api/timed")
      .set("Cookie", `sb-access-token=${TOKEN}`);
    expect(res.status).toBe(200);
    const steps = timingLines()[0]!.pre_steps as PreStep[];
    expect(steps.map((s) => s.step)).toEqual([
      "auth_session_refresh",
      "auth_profile",
    ]);
  });

  it("carries no token, cookie, email or user id", async () => {
    state.refresh = true;
    await request(app())
      .get("/api/timed")
      .set("Cookie", `sb-access-token=${TOKEN}`);
    const serialised = JSON.stringify(timingLines());
    expect(serialised).toContain("auth_session_refresh"); // presence before absence
    for (const forbidden of [TOKEN, "SECRET", EMAIL, USER_ID, "sb-"]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it("a mutation goes through the REAL CSRF check: refused without a token, timed with one", async () => {
    const agent = request.agent(app());
    const refused = await agent
      .post("/api/timed")
      .set("Cookie", `sb-access-token=${TOKEN}`)
      .set("Origin", "http://localhost:5000")
      .send({});
    expect(refused.status).toBe(403);
    expect(timingLines()).toHaveLength(0);

    const tokenRes = await agent.get("/api/csrf-token");
    expect(tokenRes.status).toBe(200);
    const accepted = await agent
      .post("/api/timed")
      .set("x-csrf-token", String(tokenRes.body.csrfToken))
      .set("Origin", "http://localhost:5000")
      .send({});
    expect(accepted.status).toBe(200);
    const steps = timingLines()[0]!.pre_steps as PreStep[];
    expect(steps.map((s) => s.step)).toEqual(["auth_session", "auth_profile"]);
  });

  it("the 401 path is unchanged: no user, no handler, no timing line", async () => {
    state.signedIn = false;
    const res = await request(app()).get("/api/timed");
    expect(res.status).toBe(401);
    expect(timingLines()).toHaveLength(0);
  });
});
