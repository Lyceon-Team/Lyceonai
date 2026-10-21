/**
 * The deletion lock takes `deleted_at` from the auth step's profile read — real middleware, real
 * resolver, real PostgreSQL.
 *
 * @spec [owner ruling (Karl) 2026-10-20 on #1271, Q2 ("the deletion lock may take deleted_at from
 *        the profile read the auth step already makes, removing that read ... Outcomes (active,
 *        pending, deleted, unavailable on read failure) must stay identical"); owner ruling
 *        2026-10-19 on #1257, ruling 1 (the profile read now runs beside getUser()); Doc-01_V8
 *        §40.3] | @implemented [2026-10-20]
 *
 * plain English: `supabaseAuthMiddleware` → `enforceDeletionLock` → a timed route, exactly as
 * server/index.ts orders them, with ACCOUNT_DELETION_LIFECYCLE_V2 on and the lock handed the REAL
 * default resolver (`defaultDeletionStatusResolverForTests`). Seams: the Auth server (`getUser()`
 * costs one counted, slowed round trip and verifies the acting student) and the database transport
 * (the hot-path harness's counted, slowed transport over this repo's migrations). The session
 * cookie claims the acting student's id, so the profile read starts beside `getUser()`.
 *
 * Asserted:
 *   - ONE `profiles` read per request (the auth step's), ONE `account_deletion_requests` read
 *     (the lock's), and a pre-handler chain two waits deep at 25 ms per round trip (getUser ∥
 *     profile, then the lock); without the session-cookie claim it is three (getUser, profile,
 *     lock);
 *   - outcomes as before: active → admitted; pending → 403 PENDING_DELETION, the allowlisted
 *     GET /api/profile still admitted; deleted (over a set deleted_at) → 403 ACCOUNT_DELETED; the
 *     completed-request read failing → 503 DELETION_STATUS_UNAVAILABLE.
 *   - a failed profile read: the auth step's own failure (500 "Failed to load user profile"), as it
 *     always was for that read; there is no longer a second, separately failing profile read.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { PG_AVAILABLE } from "../helpers/pg-supabase";
import {
  NEW_STUDENT,
  STUDENT,
  bootHarness,
  callsTo,
  harness,
  sequentialDepth,
  shutdownHarness,
} from "../perf/hot-paths.harness";

vi.mock("../../apps/api/src/lib/supabase-server", async () => {
  const h = await import("../perf/hot-paths.harness");
  return { supabaseServer: h.transportProxy() };
});
vi.mock("@supabase/supabase-js", async (importOriginal) => {
  const original = await importOriginal<object>();
  const h = await import("../perf/hot-paths.harness");
  return { ...original, createClient: () => h.transportProxy() };
});
vi.mock("../../server/lib/supabase-ssr", async () => {
  const h = await import("../perf/hot-paths.harness");
  return {
    createSupabaseServerClient: () => ({
      auth: {
        getUser: async () => {
          h.harness.roundTrips += 1;
          const start = performance.now();
          if (h.harness.latencyMs > 0)
            await new Promise((r) => setTimeout(r, h.harness.latencyMs));
          h.harness.intervals.push({ start, end: performance.now() });
          return {
            data: {
              user: {
                id: h.harness.actingStudent,
                email: `${h.harness.actingStudent}@example.test`,
              },
            },
            error: null,
          };
        },
      },
    }),
  };
});

const LATENCY_MS = 25;
const FLAG = "ACCOUNT_DELETION_LIFECYCLE_V2";

/** The `@supabase/ssr` session cookie whose access token claims `sub`. */
function claiming(sub: string): string {
  const part = (v: string): string => Buffer.from(v).toString("base64url");
  const jwt = `${part('{"alg":"ES256"}')}.${part(JSON.stringify({ sub }))}.c2lnbmF0dXJl`;
  const blob = JSON.stringify({ access_token: jwt });
  return `sb-bench-auth-token=base64-${Buffer.from(blob).toString("base64")}`;
}

type Auth = typeof import("../../server/middleware/supabase-auth");

describe.skipIf(!PG_AVAILABLE)(
  "deletion lock: deleted_at folded into the auth step's profile read",
  () => {
    let auth: Auth;
    let app: Express;

    beforeAll(async () => {
      process.env[FLAG] = "true";
      await bootHarness("deletion_lock_folded");
      auth = await import("../../server/middleware/supabase-auth");
      auth.setDeletionStatusResolverForTests(
        auth.defaultDeletionStatusResolverForTests,
      );
      const { requestIdMiddleware } =
        await import("../../server/middleware/request-id");
      const { timedRoute } = await import("../../server/lib/step-timer");
      app = express();
      app.use(requestIdMiddleware);
      // codeql[js/missing-token-validation]: false positive — read-only GET routes in a test app.
      app.use(cookieParser());
      app.use(auth.supabaseAuthMiddleware);
      app.use(auth.enforceDeletionLock);
      app.get(
        "/api/calendar",
        auth.requireSupabaseAuth,
        timedRoute("calendar.read", async (_req, res) => {
          res.json({ ok: true });
        }),
      );
      app.get("/api/profile", auth.requireSupabaseAuth, (_req, res) => {
        res.json({ ok: true });
      });
    }, 240_000);

    afterAll(async () => {
      auth.setDeletionStatusResolverForTests(null);
      delete process.env[FLAG];
      await shutdownHarness();
    });

    beforeEach(async () => {
      harness.latencyMs = 0;
      harness.actingStudent = STUDENT;
      await harness.setup!.query(
        `DELETE FROM public.account_deletion_requests`,
      );
      await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = NULL WHERE id = ANY($1::uuid[])`,
        [[STUDENT, NEW_STUDENT]],
      );
    });

    async function measured(cookie: string | null) {
      const profiles = callsTo("profiles");
      const requests = callsTo("account_deletion_requests");
      const from = harness.intervals.length;
      harness.latencyMs = LATENCY_MS;
      const r = request(app).get("/api/calendar");
      const res = await (cookie === null ? r : r.set("Cookie", cookie));
      harness.latencyMs = 0;
      return {
        res,
        profileReads: callsTo("profiles") - profiles,
        requestReads: callsTo("account_deletion_requests") - requests,
        depth: sequentialDepth(harness.intervals.slice(from)),
      };
    }

    it("one profiles read, one lock read, two waits deep", async () => {
      const m = await measured(claiming(STUDENT));
      expect(m.res.status).toBe(200);
      expect(m.profileReads).toBe(1);
      expect(m.requestReads).toBe(1);
      expect(m.depth).toBe(2);
    });

    it("without a session-cookie claim: still one profiles read, three waits deep", async () => {
      const m = await measured(null);
      expect(m.res.status).toBe(200);
      expect(m.profileReads).toBe(1);
      expect(m.requestReads).toBe(1);
      expect(m.depth).toBe(3);
    });

    it("pending deletion: 403 PENDING_DELETION; the allowlist still admitted", async () => {
      await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = now() WHERE id = $1`,
        [STUDENT],
      );
      await harness.setup!.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, actor_profile_id, status, scheduled_hard_delete_at)
         VALUES ($1, $1, 'pending', now() + interval '7 days')`,
        [STUDENT],
      );
      const m = await measured(claiming(STUDENT));
      expect(m.res.status).toBe(403);
      expect(m.res.body).toMatchObject({ code: "PENDING_DELETION" });
      expect(m.profileReads).toBe(1);
      const allowlisted = await request(app)
        .get("/api/profile")
        .set("Cookie", claiming(STUDENT));
      expect(allowlisted.status).toBe(200);
    });

    it("deleted (over a set deleted_at): 403 ACCOUNT_DELETED", async () => {
      await harness.setup!.query(
        `UPDATE public.profiles SET deleted_at = now() - interval '8 days' WHERE id = $1`,
        [STUDENT],
      );
      await harness.setup!.query(
        `INSERT INTO public.account_deletion_requests
           (profile_id, actor_profile_id, status, scheduled_hard_delete_at, completion_at)
         VALUES ($1, $1, 'completed', now() - interval '1 day', now())`,
        [STUDENT],
      );
      const m = await measured(claiming(STUDENT));
      expect(m.res.status).toBe(403);
      expect(m.res.body).toMatchObject({ code: "ACCOUNT_DELETED" });
    });

    it("the completed-request read fails: 503 DELETION_STATUS_UNAVAILABLE", async () => {
      await harness.setup!.query(
        `ALTER TABLE public.account_deletion_requests RENAME TO account_deletion_requests_x`,
      );
      try {
        const m = await measured(claiming(STUDENT));
        expect(m.res.status).toBe(503);
        expect(m.res.body).toMatchObject({
          code: "DELETION_STATUS_UNAVAILABLE",
        });
      } finally {
        await harness.setup!.query(
          `ALTER TABLE public.account_deletion_requests_x RENAME TO account_deletion_requests`,
        );
      }
    });

    it("a failed profile read is the auth step's own failure (500), as it always was for that read", async () => {
      await harness.setup!.query(
        `ALTER TABLE public.profiles RENAME COLUMN deleted_at TO deleted_at_x`,
      );
      try {
        const m = await measured(claiming(STUDENT));
        expect(m.res.status).toBe(500);
        expect(m.res.body).toEqual({ error: "Failed to load user profile" });
      } finally {
        await harness.setup!.query(
          `ALTER TABLE public.profiles RENAME COLUMN deleted_at_x TO deleted_at`,
        );
      }
    });
  },
);
