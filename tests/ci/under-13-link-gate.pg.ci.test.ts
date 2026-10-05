/**
 * An under-13 student without an ACTIVE guardian link reaches only the linking surface and account
 * essentials. Every learning endpoint answers 403 `GUARDIAN_LINK_REQUIRED`, read live from the link
 * on every request, with the endpoint list read from the running app's router.
 *
 * @spec [Guardian_Closure_Plan G2-04; owner ruling R6 (2026-09-27); SCL-187 rule 1 (accepted
 *       2026-09-29); owner approval 2026-09-29 (the allowed set, billing checkout/portal closed,
 *       the mid-session unlink case)] | @implemented [2026-09-29]
 *
 * plain English: imports the REAL Express app and classifies every /api endpoint by the gate
 * functions in its chain (function identity, via tests/helpers/router-endpoints). An endpoint is
 * LINK-GATED when its chain holds `requireStudentOrAdmin` or `requireStudentAccount` (each ends in
 * the link gate) or `requireGuardianLinkForUnder13` itself. Every other /api endpoint must be in the approved
 * allowed set or on a surface that is not the student's at all — so a learning route added without
 * the gate fails the classification case, and there is no list of learning routes to go stale.
 *
 * Then, for one under-13 student, across the whole life of a link:
 *   1. no link: every link-gated endpoint → 403 GUARDIAN_LINK_REQUIRED; the allowed set answers;
 *   2. a guardian redeems the student's code (the real redeem route): no endpoint answers
 *      GUARDIAN_LINK_REQUIRED, and the named learning reads return 200;
 *   3. the guardian unlinks partway through the session: the student's very next learning request
 *      is 403 — no new sign-in, no new session; the student unlinking does the same;
 *   4. billing: checkout and portal closed for the unlinked student; a linked guardian can still
 *      start checkout for that student.
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (real SQL over genesis + every migration);
 * the SESSION — `supabaseAuthMiddleware` skips the Auth server's `getUser()` and runs the REAL
 * profile loader (`ensureProfileForAuthUser`) against that Postgres on every request, exactly as
 * the real middleware does, so nothing about the caller is cached between requests; CSRF (passed
 * through, so a 403 is a gate's, and the body assertion enforces that); and the Stripe CLIENT (no
 * network). Every gate, router, mount and SQL function is the production one.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { Client } from "pg";
import request from "supertest";
import type { User } from "@supabase/supabase-js";
import type { Express, NextFunction, Request, Response } from "express";
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";
import { collectEndpoints } from "../helpers/router-endpoints";

const DB_NAME = "under_13_link_gate_ci";
const KID = "d1111111-1111-4111-8111-111111111111";
const GUARDIAN = "d2222222-2222-4222-8222-222222222222";
/** G2-06: a student whose age is unknown — no date of birth, profile not completed. */
const NO_DOB = "d3333333-3333-4333-8333-333333333333";
const EMAILS: Record<string, string> = {
  [KID]: "kid-g204@example.test",
  [GUARDIAN]: "guardian-g204@example.test",
  [NO_DOB]: "nodob-g206@example.test",
};

let pg: Client;
const session = { id: KID };

const stripeApi = vi.hoisted(() => ({
  checkoutCreate: vi.fn(async () => ({
    id: "cs_test_g204",
    url: "https://checkout.stripe.test/cs_test_g204",
  })),
}));

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  get supabaseServer() {
    return makePgSupabase(pg);
  },
  supabaseAdmin: {
    get from() {
      return makePgSupabase(pg).from;
    },
  },
}));

// `GET /api/practice/topics` reads canonical_skill_catalog through the admin client (F-56).
vi.mock("../../apps/api/src/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makePgSupabase(pg),
}));

vi.mock("../../server/lib/stripe/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/stripe/client")>();
  return {
    ...actual,
    getStripeClient: () => ({
      customers: {
        create: async () => ({ id: "cus_test_g204" }),
        retrieve: async () => ({
          id: "cus_test_g204",
          address: { country: "US" },
        }),
      },
      subscriptions: { list: async () => ({ data: [] }) },
      checkout: { sessions: { create: stripeApi.checkoutCreate } },
      billingPortal: {
        sessions: {
          create: async () => ({ url: "https://portal.stripe.test/g204" }),
        },
      },
    }),
  };
});

vi.mock(
  "../../server/lib/entitlement-runtime-config",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../server/lib/entitlement-runtime-config")
      >();
    // The country gate has its own suite; here the payer is eligible.
    return { ...actual, getTier1Countries: async () => ["US"] };
  },
);

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    supabaseAuthMiddleware: async (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      try {
        const { ensureProfileForAuthUser } =
          await import("../../server/lib/profile-bootstrap");
        const user = {
          id: session.id,
          email: EMAILS[session.id],
        } as unknown as User;
        const profile = await ensureProfileForAuthUser(
          makePgSupabase(pg) as never,
          user,
          { source: "supabase_auth_middleware" },
        );
        (req as Request & { user?: unknown }).user = {
          ...profile,
          isAdmin: profile.role === "admin",
          isGuardian: profile.role === "guardian",
        };
        next();
      } catch (err) {
        next(err);
      }
    },
  };
});

vi.mock(
  "../../server/middleware/csrf-double-submit",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
      ...actual,
      doubleCsrfProtection: (
        _req: Request,
        _res: Response,
        next: NextFunction,
      ) => next(),
    };
  },
);

process.env.VITEST = "true";
process.env.NODE_ENV = "test";
process.env.STRIPE_PRICE_PARENT_MONTHLY = "price_test_g204_monthly";
process.env.STRIPE_PRICE_PARENT_QUARTERLY = "price_test_g204_quarterly";
process.env.STRIPE_PRICE_PARENT_YEARLY = "price_test_g204_yearly";

const app = (await import("../../server/index")).default as Express;
const auth = await import("../../server/middleware/supabase-auth");

type Gate = "link" | "student_only";

function gateOf(handle: unknown): Gate | null {
  if (handle === auth.requireStudentOrAdmin) return "link";
  // Brief 8: the student-account gate (background) ends in the link gate the same way.
  if (handle === auth.requireStudentAccount) return "link";
  if (
    "requireGuardianLinkForUnder13" in auth &&
    handle === auth.requireGuardianLinkForUnder13
  ) {
    return "link";
  }
  if (handle === auth.requireStudentOnly) return "student_only";
  return null;
}

const endpoints = collectEndpoints(app, gateOf);
const linkGated = endpoints.filter((e) => e.gates.includes("link"));
const tutorOnly = endpoints.filter(
  (e) => e.gates.includes("student_only") && !e.gates.includes("link"),
);

const key = (method: string, path: string): string =>
  `${method.toUpperCase()} ${path.replace(/\/$/, "")}`;

/**
 * THE APPROVED ALLOWED SET (owner, 2026-09-29), verbatim in scope: reachable by an under-13
 * student with no active link. Exact endpoints where the approval named endpoints; a prefix only
 * where it named a whole surface.
 */
const ALLOWED_EXACT: ReadonlySet<string> = new Set([
  "GET /api/csrf-token",
  "GET /api/profile",
  "PATCH /api/profile",
  "POST /api/profile/date-of-birth",
  // self-path linking
  "GET /api/students/:studentId/link-code",
  "POST /api/students/:studentId/link-code/regenerate",
  "POST /api/students/:studentId/link-code/invite",
  "GET /api/students/:studentId/links",
  "DELETE /api/students/:studentId/links/:linkId",
  // account essentials
  // (`GET /api/account/status` was here; `cleanup` deleted that route as unused — register UI-06.)
  "POST /api/account/delete",
  "POST /api/account/cancel-deletion",
  "POST /api/account/recover-deletion",
  "GET /api/account/email-suppression",
  "POST /api/account/email-suppression/clear",
  // billing reads
  "GET /api/billing/status",
  "GET /api/billing/plans",
  "GET /api/billing/publishable-key",
  // Not in the approval by name: answers 409 ACCOUNT_SELECTION_DISABLED to every caller and
  // reads and writes nothing (server/routes/account-routes.ts). Listed so it is visible here.
  "POST /api/account/select",
]);
const ALLOWED_PREFIXES: ReadonlyArray<string> = [
  "/api/auth/",
  "/api/health",
  "/api/legal/",
  "/api/notifications/",
];
/** Surfaces that are not the student's at all; each has its own role or secret gate. */
const NOT_A_STUDENT_SURFACE: ReadonlyArray<string> = [
  "/api/_whoami", // 404 in production; diagnostics
  "/api/admin/", // requireSupabaseAdmin
  "/api/guardian/", // requireGuardianRole (G2-01: guardians only)
  "/api/internal/", // CRON_SECRET / OIDC
  "/api/public/", // anonymous pricing
  "/api/webhooks/", // signature-verified
  "/api/billing/webhook", // Stripe, signature-verified; no session
  // requireSupabaseAdmin: the one surviving /api/questions route is admin-only on `cleanup`
  // (register UI-05/UI-07); the student-facing /api/questions routes were deleted.
  "/api/questions/stats",
];

function isAllowed(method: string, path: string): boolean {
  const k = key(method, path);
  if (ALLOWED_EXACT.has(k)) return true;
  const p = path.replace(/\/$/, "");
  return [...ALLOWED_PREFIXES, ...NOT_A_STUDENT_SURFACE].some(
    (prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix),
  );
}

function concrete(path: string, studentId: string = KID): string {
  return (
    path
      .replace(/:studentId/g, studentId)
      .replace(/:[A-Za-z_]+/g, "00000000-0000-4000-8000-0000000000aa")
      .replace(/\/$/, "") || "/"
  );
}

async function call(
  method: string,
  path: string,
  body: object = {},
  studentId: string = KID,
): Promise<request.Response> {
  const agent = request(app);
  const url = concrete(path, studentId);
  switch (method) {
    case "get":
      return agent.get(url);
    case "post":
      return agent.post(url).send(body);
    case "put":
      return agent.put(url).send(body);
    case "patch":
      return agent.patch(url).send(body);
    case "delete":
      return agent.delete(url);
    default:
      throw new Error(`unsupported method ${method}`);
  }
}

const GLR = "GUARDIAN_LINK_REQUIRED";
const PROFILE_INCOMPLETE = "PROFILE_INCOMPLETE";

/** Learning reads a free, admitted student is served with 200 — the presence side of the gate. */
const learningReads = (studentId: string): ReadonlyArray<string> => [
  "/api/progress/kpis",
  `/api/students/${studentId}/kpi/overall`,
  "/api/practice/topics",
];
const LEARNING_READS = learningReads(KID);

/** Safe reads from the allowed set: 200 in every state. */
const allowedReads = (studentId: string): ReadonlyArray<string> => [
  "/api/profile",
  `/api/students/${studentId}/link-code`,
  `/api/students/${studentId}/links`,
  "/api/billing/status",
];
const ALLOWED_READS = allowedReads(KID);

async function redeemAsGuardian(): Promise<string> {
  session.id = KID;
  const codeRes = await request(app).get(`/api/students/${KID}/link-code`);
  expect(codeRes.status).toBe(200);
  const code = codeRes.body.data?.code as string;
  expect(typeof code).toBe("string");

  session.id = GUARDIAN;
  const redeem = await request(app)
    .post("/api/guardian/link/redeem")
    .send({ code, acceptParentGuardianTerms: true });
  expect(redeem.status).toBe(201);
  session.id = KID;

  const link = await pg.query(
    `SELECT id FROM public.guardian_links
      WHERE guardian_profile_id = $1 AND student_profile_id = $2 AND status = 'active'`,
    [GUARDIAN, KID],
  );
  expect(link.rows).toHaveLength(1);
  return link.rows[0].id as string;
}

async function expectAllowedReadsServed(
  reads: ReadonlyArray<string> = ALLOWED_READS,
): Promise<void> {
  for (const url of reads) {
    const res = await request(app).get(url);
    expect(res.status, `${url} → ${res.status}`).toBe(200);
  }
}

describe.skipIf(!PG_AVAILABLE)(
  "G2-04 the under-13 link gate, read live on every request — real Postgres, routes from the router",
  // Two cases walk every learning endpoint through the real app; the default 5 s is too short.
  { timeout: 120_000 },
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
        [KID, EMAILS[KID], GUARDIAN, EMAILS[GUARDIAN], NO_DOB, EMAILS[NO_DOB]],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, display_name, date_of_birth, profile_completed_at) VALUES
         ($1,$2,'student','Kid',(current_date - interval '10 years')::date, now()),
         ($3,$4,'guardian','Gia',DATE '1980-01-01', now())`,
        [KID, EMAILS[KID], GUARDIAN, EMAILS[GUARDIAN]],
      );
      // Presence before absence: the principal is a real, completed, under-13 student row.
      const back = await pg.query(
        `SELECT role::text AS role, is_under_13 FROM public.profiles WHERE id = $1`,
        [KID],
      );
      expect(back.rows[0]).toEqual({ role: "student", is_under_13: true });
      // G2-06: the age-unknown principal — the state 82 production profiles are in (owner count,
      // 2026-09-29): a student row with no date of birth and no completed profile.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1,$2,'student')`,
        [NO_DOB, EMAILS[NO_DOB]],
      );
      const nodob = await pg.query(
        `SELECT role::text AS role, date_of_birth, is_under_13, profile_completed_at
           FROM public.profiles WHERE id = $1`,
        [NO_DOB],
      );
      expect(nodob.rows[0]).toEqual({
        role: "student",
        date_of_birth: null,
        is_under_13: null,
        profile_completed_at: null,
      });
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      session.id = KID;
      stripeApi.checkoutCreate.mockClear();
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
    });

    it("the sweep is non-trivial: it found the learning endpoints the gate must close", () => {
      const has = (m: string, p: string) =>
        linkGated.some((e) => key(e.method, e.path) === key(m, p));
      expect(has("post", "/api/practice/answer")).toBe(true);
      expect(has("post", "/api/tests/sessions")).toBe(true);
      expect(has("post", "/api/review/answer")).toBe(true);
      expect(has("put", "/api/calendar/profile")).toBe(true);
      // `GET /api/questions` was deleted on `cleanup` (register UI-05); the question-bank read a
      // student still has is the practice reference list.
      expect(has("get", "/api/practice/reference/questions")).toBe(true);
      expect(has("get", "/api/progress/kpis")).toBe(true);
      expect(has("get", "/api/students/:studentId/kpi/overall")).toBe(true);
      expect(has("get", "/api/students/:studentId/mastery/domains")).toBe(true);
      expect(has("get", "/api/students/:studentId/calendar")).toBe(true);
      expect(has("post", "/api/billing/checkout")).toBe(true);
      expect(has("post", "/api/billing/portal")).toBe(true);
      expect(linkGated.length).toBeGreaterThanOrEqual(60);
    });

    it("every /api endpoint is link-gated, tutor-only, or in the approved allowed set", () => {
      const unclassified = endpoints
        .filter((e) => e.gates.length === 0)
        .filter((e) => !isAllowed(e.method, e.path))
        .map((e) => key(e.method, e.path));
      expect(unclassified).toEqual([]);
      // ...and nothing in the allowed set carries the gate: allowed means reachable.
      const allowedButGated = linkGated
        .filter((e) => ALLOWED_EXACT.has(key(e.method, e.path)))
        .map((e) => key(e.method, e.path));
      expect(allowedButGated).toEqual([]);
    });

    it("tutor stays behind its own under-13 block, link or no link", async () => {
      expect(tutorOnly.length).toBeGreaterThan(0);
      await redeemAsGuardian();
      for (const e of tutorOnly) {
        const res = await call(e.method, e.path);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("AGE_RESTRICTION");
      }
    });

    describe("no active link", () => {
      it.each(
        linkGated.map((e) => [e.method.toUpperCase(), e.path, e] as const),
      )(
        "under-13, unlinked → 403 GUARDIAN_LINK_REQUIRED on %s %s",
        async (_m, _p, e) => {
          const res = await call(e.method, e.path);
          expect(res.status).toBe(403);
          expect(res.body.code).toBe(GLR);
        },
      );

      it("the allowed set answers: reads are served, and the linking writes are past the gate", async () => {
        await expectAllowedReadsServed();
        const regen = await request(app).post(
          `/api/students/${KID}/link-code/regenerate`,
        );
        expect(regen.status).toBe(200);
        // An empty body is refused by the route's own schema — i.e. the request got past every gate.
        const invite = await request(app)
          .post(`/api/students/${KID}/link-code/invite`)
          .send({});
        expect(invite.status).toBe(400);
        expect(invite.body.code).not.toBe(GLR);
      });
    });

    describe("after a guardian redeems the student's code", () => {
      it("no endpoint answers GUARDIAN_LINK_REQUIRED", async () => {
        await redeemAsGuardian();
        const refused: string[] = [];
        for (const e of linkGated) {
          const res = await call(e.method, e.path);
          if (res.body?.code === GLR) refused.push(key(e.method, e.path));
        }
        expect(refused).toEqual([]);
      });

      it("the learning reads are served with 200, and the allowed set still answers", async () => {
        await redeemAsGuardian();
        for (const url of LEARNING_READS) {
          const res = await request(app).get(url);
          expect(res.status, `${url} → ${res.status}`).toBe(200);
        }
        await expectAllowedReadsServed();
      });
    });

    describe("unlinking partway through a session", () => {
      it("a guardian unlinks: the student's very next learning request is 403, without signing in again", async () => {
        await redeemAsGuardian();
        const before = await request(app).get("/api/progress/kpis");
        expect(before.status).toBe(200);

        session.id = GUARDIAN;
        const unlink = await request(app).delete(`/api/guardian/link/${KID}`);
        expect(unlink.status).toBe(200);
        session.id = KID;

        // Same student, same session state — the only thing that changed is the link row.
        const next = await request(app).get("/api/progress/kpis");
        expect(next.status).toBe(403);
        expect(next.body.code).toBe(GLR);
        const write = await request(app).post("/api/practice/answer").send({});
        expect(write.status).toBe(403);
        expect(write.body.code).toBe(GLR);
        // ...and the way back is still open.
        await expectAllowedReadsServed();
      });

      it("the student unlinks their last guardian: access closes the same way", async () => {
        const linkId = await redeemAsGuardian();
        expect((await request(app).get("/api/progress/kpis")).status).toBe(200);

        const unlink = await request(app).delete(
          `/api/students/${KID}/links/${linkId}`,
        );
        expect(unlink.status).toBe(200);

        const next = await request(app).get("/api/progress/kpis");
        expect(next.status).toBe(403);
        expect(next.body.code).toBe(GLR);
      });
    });

    describe("billing", () => {
      it("the unlinked under-13 student cannot start checkout or open the portal", async () => {
        const checkout = await request(app)
          .post("/api/billing/checkout")
          .send({ plan: "monthly" });
        expect(checkout.status).toBe(403);
        expect(checkout.body.code).toBe(GLR);
        const portal = await request(app).post("/api/billing/portal").send({});
        expect(portal.status).toBe(403);
        expect(portal.body.code).toBe(GLR);
        expect(stripeApi.checkoutCreate).not.toHaveBeenCalled();
      });

      it("a guardian linked to the under-13 student can still start checkout for them", async () => {
        await redeemAsGuardian();
        session.id = GUARDIAN;
        const res = await request(app)
          .post("/api/billing/checkout")
          .send({ plan: "monthly", student_profile_id: KID });
        expect(res.status).toBe(200);
        expect(res.body.url).toBe("https://checkout.stripe.test/cs_test_g204");
        expect(stripeApi.checkoutCreate).toHaveBeenCalledTimes(1);
        const [params] = stripeApi.checkoutCreate.mock.calls[0] as unknown as [
          { metadata?: Record<string, string> },
        ];
        expect(params.metadata?.student_profile_id).toBe(KID);
        expect(params.metadata?.payer_profile_id).toBe(GUARDIAN);
      });
    });

    // G2-06 (G-NEW-09): learning requires a known age. Ordered: the refusals first, the completion
    // last (it fixes the date of birth, which G2-03 then locks).
    describe("G2-06: a student whose age is unknown (no date of birth)", () => {
      beforeEach(() => {
        session.id = NO_DOB;
      });

      it.each(
        linkGated.map((e) => [e.method.toUpperCase(), e.path, e] as const),
      )("age unknown → 403 PROFILE_INCOMPLETE on %s %s", async (_m, _p, e) => {
        const res = await call(e.method, e.path, {}, NO_DOB);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe(PROFILE_INCOMPLETE);
      });

      it("reaches the whole allowed set: reads served, linking writes past the gate", async () => {
        await expectAllowedReadsServed(allowedReads(NO_DOB));
        const regen = await request(app).post(
          `/api/students/${NO_DOB}/link-code/regenerate`,
        );
        expect(regen.status).toBe(200);
        const invite = await request(app)
          .post(`/api/students/${NO_DOB}/link-code/invite`)
          .send({});
        expect(invite.status).toBe(400);
        expect(invite.body.code).not.toBe(PROFILE_INCOMPLETE);
        const legal = await request(app).get("/api/legal/acceptances");
        expect(legal.body?.code).not.toBe(PROFILE_INCOMPLETE);
      });

      it("a guardian reading that student under /api/students/:id is not refused for it", async () => {
        await pg.query(
          `SELECT public.create_active_guardian_link_audited($1::uuid, $2::uuid, 'g2-06')`,
          [GUARDIAN, NO_DOB],
        );
        session.id = GUARDIAN;
        for (const path of [
          `/api/students/${NO_DOB}/kpi/overall`,
          `/api/students/${NO_DOB}/calendar`,
        ]) {
          const res = await request(app).get(path);
          // The guardian's own gates (link, the student's entitlement) still apply; the
          // student's missing date of birth is not one of them.
          expect(res.body?.code, `${path} → ${res.status}`).not.toBe(
            PROFILE_INCOMPLETE,
          );
          expect(res.status).not.toBe(403);
        }
      });

      it("after completing the profile with an adult date of birth, the learning endpoints answer", async () => {
        const adult = new Date();
        adult.setUTCFullYear(adult.getUTCFullYear() - 18);
        const complete = await request(app)
          .patch("/api/profile")
          .send({
            displayName: "Nodob",
            role: "student",
            dateOfBirth: adult.toISOString().slice(0, 10),
          });
        expect(complete.status).toBe(200);

        for (const url of learningReads(NO_DOB)) {
          const res = await request(app).get(url);
          expect(res.status, `${url} → ${res.status}`).toBe(200);
        }
        const refused: string[] = [];
        for (const e of linkGated) {
          const res = await call(e.method, e.path, {}, NO_DOB);
          if (res.body?.code === PROFILE_INCOMPLETE || res.body?.code === GLR) {
            refused.push(key(e.method, e.path));
          }
        }
        expect(refused).toEqual([]);
      });
    });
  },
);
