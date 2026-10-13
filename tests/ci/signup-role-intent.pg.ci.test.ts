/**
 * Guardian intent survives BOTH ways of creating an account.
 *
 * @spec [owner brief "Entry-aware sign-in / sign-up" (Karl, 2026-10-10) rule 2: "the email
 *       sign-up and the Google redirect … both land a guardian-intent user as a guardian.
 *       Guardian-intent sign-ups must never become student accounts."; G1-02 R1 (the one-time role
 *       choice)] | @implemented [2026-10-10]
 *
 * plain English: a round trip — the REAL sign-up route and the REAL Google callback over real
 * Postgres, with the REAL `handle_new_user` trigger re-armed (bootstrap drops it) so the profile
 * row is the one production would create. Only the GoTrue transport is a stand-in: its `signUp`
 * inserts the `auth.users` row with the metadata the route passed (what GoTrue does), and its
 * `exchangeCodeForSession` inserts a Google user with Google's metadata and no role of ours.
 * Proved:
 *   - email: `role: "guardian"` creates a guardian; no role, an unknown or a near-miss value
 *     creates a student; admin is refused with no account at all;
 *   - Google: `role=guardian` on the callback makes the account THIS sign-in created a guardian
 *     and lands it on onboarding with `next` kept; without it, or with any other value, it stays
 *     a student; a returning (completed) student is never re-roled by the parameter.
 * Runs only where PGHOST is set.
 */
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
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

const DB_NAME = "signup_role_intent_ci";
let pg: Client;

/** The Google user the next `exchangeCodeForSession(code)` signs in, keyed by the code. */
type GoogleUser = { id: string; email: string; createdAt: string };
const googleUsers = new Map<string, GoogleUser>();

vi.mock("../../server/lib/supabase-ssr", () => ({
  createSupabaseServerClient: () => ({
    auth: {
      // GoTrue's sign-up: one auth.users row carrying the metadata the route sent.
      signUp: async (args: {
        email: string;
        options?: { data?: Record<string, unknown> };
      }) => {
        const id = randomUUID();
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)`,
          [id, args.email, JSON.stringify(args.options?.data ?? {})],
        );
        return {
          data: {
            user: { id, email: args.email },
            session: { access_token: "stand-in" },
          },
          error: null,
        };
      },
      // Google: a NEW auth user is created by the exchange with Google's own metadata only.
      exchangeCodeForSession: async (code: string) => {
        const user = googleUsers.get(code);
        if (!user) {
          return {
            data: { session: null, user: null },
            error: { message: "bad" },
          };
        }
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3)
           ON CONFLICT (id) DO NOTHING`,
          [user.id, user.email, JSON.stringify({ full_name: "Google Person" })],
        );
        return {
          data: {
            session: { access_token: "stand-in" },
            user: {
              id: user.id,
              email: user.email,
              created_at: user.createdAt,
            },
          },
          error: null,
        };
      },
      verifyOtp: async () => ({
        data: { session: null, user: null },
        error: { message: "unused" },
      }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

// CSRF is not what this suite proves, and the real double-submit is proved where it is the
// subject (tests/ci/csrf-runtime.contract.test.ts, tests/ci/auth-signup.contract.test.ts). Here it
// passes through, so the harness needs no cookie handling at all.
vi.mock("../../server/middleware/csrf-double-submit", () => ({
  doubleCsrfProtection: (_req: Request, _res: Response, next: NextFunction) =>
    next(),
}));

/** The signed-in account for the profile routes (the consent cases), read per request. */
const session = vi.hoisted(() => ({ userId: null as string | null }));

vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getSupabaseAdmin: () => makePgSupabase(pg),
    // The profile routes' identity, as the real middleware builds it from `profiles`.
    requireSupabaseAuth: async (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      const { rows } = await pg.query<{
        id: string;
        email: string;
        role: string;
        is_under_13: boolean | null;
      }>(
        `SELECT id, email, role::text AS role, is_under_13 FROM public.profiles WHERE id = $1`,
        [session.userId],
      );
      const row = rows[0];
      if (!row) {
        res.status(401).json({ error: "no session" });
        return;
      }
      (req as Request & { user?: unknown }).user = {
        id: row.id,
        email: row.email,
        display_name: null,
        role: row.role,
        isAdmin: false,
        isGuardian: row.role === "guardian",
        is_under_13: row.is_under_13 === true,
        actor_id: row.id,
      };
      next();
    },
  };
});
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

const ENV_KEYS = [
  "NODE_ENV",
  "VITEST",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "PUBLIC_SITE_URL",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

async function loadApp(): Promise<express.Express> {
  vi.resetModules();
  // The sign-up route answers 400 without calling GoTrue under the test placeholder; this
  // suite is the call, so it runs as a configured server would.
  process.env.NODE_ENV = "development";
  process.env.VITEST = "";
  process.env.SUPABASE_URL = "https://lyceon-ci.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.PUBLIC_SITE_URL = "https://app.lyceon.test";
  const { default: authRoutes } =
    await import("../../server/routes/supabase-auth-routes");
  const { default: oauthRoutes } =
    await import("../../server/routes/oauth-callback-routes");
  const { default: profileRoutes } =
    await import("../../server/routes/profile-routes");
  const { default: guardianRoutes } =
    await import("../../server/routes/guardian-routes");
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = "req-signup-role-intent";
    next();
  });
  app.use("/api/auth", authRoutes);
  app.use("/auth", oauthRoutes);
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  app.use("/api/guardian", guardianRoutes);
  return app;
}

async function emailSignup(
  app: express.Express,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app)
    .post("/api/auth/signup")
    .send({ password: "Long-enough-pass-1!", displayName: "Pat", ...body });
}

async function roleByEmail(email: string): Promise<string | null> {
  const { rows } = await pg.query<{ role: string }>(
    `SELECT role::text AS role FROM public.profiles WHERE email = $1`,
    [email],
  );
  return rows[0]?.role ?? null;
}

/** The acceptance rows sign-up wrote, as `doc_key/actor_type`, sorted. */
async function consentRows(email: string): Promise<string[]> {
  const { rows } = await pg.query<{ k: string }>(
    `SELECT la.doc_key || '/' || la.actor_type AS k
       FROM public.legal_acceptances la
       JOIN public.profiles p ON p.id = la.user_id
      WHERE p.email = $1
      ORDER BY 1`,
    [email],
  );
  return rows.map((r) => r.k);
}

async function idByEmail(email: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `SELECT id FROM public.profiles WHERE email = $1`,
    [email],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`no profile for ${email}`);
  return id;
}

/** What the re-consent prompt would ask this account for: the real GET /api/profile. */
async function outstandingFor(
  app: express.Express,
  email: string,
): Promise<string[]> {
  session.userId = await idByEmail(email);
  const res = await request(app).get("/api/profile");
  expect(res.status).toBe(200);
  const outstanding = (
    res.body as { user?: { outstandingLegal?: { docKey: string }[] } }
  ).user?.outstandingLegal;
  expect(Array.isArray(outstanding)).toBe(true); // presence before the emptiness checks
  return (outstanding ?? []).map((d) => d.docKey).sort();
}

/** Onboarding through the real PATCH /api/profile. */
async function completeOnboarding(
  app: express.Express,
  email: string,
  role: "student" | "guardian",
): Promise<void> {
  session.userId = await idByEmail(email);
  const res = await request(app)
    .patch("/api/profile")
    .send({
      displayName: "Pat",
      role,
      dateOfBirth: role === "guardian" ? "1985-05-05" : "2010-05-05",
    });
  expect(res.status).toBe(200);
  expect(await roleByEmail(email)).toBe(role);
}

async function freshStudent(): Promise<string> {
  const studentId = randomUUID();
  await pg.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')`,
    [studentId, freshEmail("linked-student")],
  );
  return studentId;
}

/**
 * The one way a link is created: the guardian redeems the student's code through the REAL
 * POST /api/guardian/link/redeem, whose body must carry the Parent / Guardian Terms checkbox
 * (`acceptParentGuardianTerms: true`, `redeemLinkCodeRequestSchema`).
 */
async function linkByRedeem(
  app: express.Express,
  guardianEmail: string,
): Promise<void> {
  const { issueStudentLinkCode } =
    await import("../../server/lib/student-link-code");
  const issued = await issueStudentLinkCode(await freshStudent());
  expect(issued).not.toBeNull();
  session.userId = await idByEmail(guardianEmail);
  const res = await request(app)
    .post("/api/guardian/link/redeem")
    .send({ code: issued?.code, acceptParentGuardianTerms: true });
  expect(res.status).toBe(201);
}

/** A link written straight into the table, bypassing redeem (the harness's control only). */
async function linkDirectly(guardianEmail: string): Promise<void> {
  await pg.query(
    `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by)
     VALUES ($1, $2, 'active', 'guardian')`,
    [await idByEmail(guardianEmail), await freshStudent()],
  );
}

let seq = 0;
function freshEmail(tag: string): string {
  seq += 1;
  return `${tag}-${seq}@example.test`;
}

function googleSignIn(
  app: express.Express,
  query: Record<string, string>,
  user: { email: string; createdAt?: string; id?: string },
): Promise<request.Response> {
  const code = `code-${randomUUID()}`;
  googleUsers.set(code, {
    id: user.id ?? randomUUID(),
    email: user.email,
    createdAt: user.createdAt ?? new Date().toISOString(),
  });
  return request(app)
    .get("/auth/callback")
    .query({ code, consentSource: "google_continue_click", ...query });
}

describe.skipIf(!PG_AVAILABLE)(
  "guardian intent survives sign-up (real routes, real trigger, real Postgres)",
  () => {
    let app: express.Express;

    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      // Bootstrap drops it so fixtures can insert their own profiles; this suite proves the
      // profile production creates, so the real trigger function goes back on.
      await pg.query(
        `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
         FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`,
      );
      for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
      app = await loadApp();
    }, 180_000);

    beforeEach(() => {
      googleUsers.clear();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    afterAll(async () => {
      for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
      }
      await pg?.end();
    });

    describe("email sign-up", () => {
      it("role: guardian creates a guardian account", async () => {
        const email = freshEmail("email-guardian");
        const res = await emailSignup(app, { email, role: "guardian" });
        expect(res.status).toBe(201);
        expect(await roleByEmail(email)).toBe("guardian");
      });

      it("no role creates a student account, as before", async () => {
        const email = freshEmail("email-none");
        const res = await emailSignup(app, { email });
        expect(res.status).toBe(201);
        expect(await roleByEmail(email)).toBe("student");
      });

      it.each([
        ["Guardian"],
        ["guardian "],
        ["parent"],
        [["guardian"]],
        [{ role: "guardian" }],
      ])(
        "an unknown or near-miss role (%j) falls back to student",
        async (role) => {
          const email = freshEmail("email-unknown");
          const res = await emailSignup(app, { email, role });
          expect(res.status).toBe(201);
          expect(await roleByEmail(email)).toBe("student");
        },
      );

      it("admin is refused before any account exists", async () => {
        const email = freshEmail("email-admin");
        const res = await emailSignup(app, { email, role: "admin" });
        expect(res.status).toBe(403);
        expect(await roleByEmail(email)).toBeNull();
        const { rows } = await pg.query(
          `SELECT 1 FROM auth.users WHERE email = $1`,
          [email],
        );
        expect(rows).toHaveLength(0);
      });
    });

    // @spec [owner answers on #1180 (Karl, 2026-10-10): guardians are not re-prompted; a switch
    // to Student is handled by the existing re-consent flow; owner choice 2026-10-10: no code
    // change, prove both paths] | Every account owes the Student Terms and Privacy Policy, and
    // a guardian owes the Parent / Guardian Terms only once linked (SCL-084), which redeem's own
    // clickwrap records (SCL-222, AS-1b, Doc 10 §9.15). The rows sign-up writes, then the REAL
    // prompt set (GET /api/profile's outstandingLegal) after onboarding and after linking.
    describe("consent: no re-prompt on either path", () => {
      // Its own app instance, so its own sign-up rate limiter (10 per window): the email cases
      // above spend the first one.
      let consentApp: express.Express;
      beforeAll(async () => {
        consentApp = await loadApp();
      });
      const EVERY_ACCOUNT = ["privacy_policy/student", "student_terms/student"];

      it("a guardian sign-up records the two documents every account owes, by email and by Google", async () => {
        const byEmail = freshEmail("consent-email-guardian");
        expect(
          (await emailSignup(consentApp, { email: byEmail, role: "guardian" }))
            .status,
        ).toBe(201);
        expect(await consentRows(byEmail)).toEqual(EVERY_ACCOUNT);
        const byGoogle = freshEmail("consent-google-guardian");
        await googleSignIn(
          consentApp,
          { role: "guardian" },
          { email: byGoogle },
        );
        expect(await roleByEmail(byGoogle)).toBe("guardian");
        expect(await consentRows(byGoogle)).toEqual(EVERY_ACCOUNT);
      });

      it("a guardian who stays a guardian is never prompted: not after onboarding, not after linking a student", async () => {
        const email = freshEmail("consent-stays-guardian");
        expect(
          (await emailSignup(consentApp, { email, role: "guardian" })).status,
        ).toBe(201);
        await completeOnboarding(consentApp, email, "guardian");
        expect(await outstandingFor(consentApp, email)).toEqual([]);
        await linkByRedeem(consentApp, email);
        expect(await consentRows(email)).toEqual(
          [...EVERY_ACCOUNT, "parent_guardian_terms/parent"].sort(),
        );
        expect(await outstandingFor(consentApp, email)).toEqual([]);
      });

      it("the prompt is live in this harness: a guardian linked without redeem's clickwrap is asked for the Parent Terms", async () => {
        const email = freshEmail("consent-control");
        expect(
          (await emailSignup(consentApp, { email, role: "guardian" })).status,
        ).toBe(201);
        await completeOnboarding(consentApp, email, "guardian");
        await linkDirectly(email);
        expect(await outstandingFor(consentApp, email)).toEqual([
          "parent_guardian_terms",
        ]);
      });

      it("a guardian-intent account that switches to Student at onboarding is not prompted (the Student Terms are already held)", async () => {
        const email = freshEmail("consent-switch-student");
        expect(
          (await emailSignup(consentApp, { email, role: "guardian" })).status,
        ).toBe(201);
        await completeOnboarding(consentApp, email, "student");
        expect(await outstandingFor(consentApp, email)).toEqual([]);
      });
    });

    describe("Google sign-up", () => {
      it("role=guardian makes the account this sign-in created a guardian, and keeps next", async () => {
        const email = freshEmail("google-guardian");
        const res = await googleSignIn(
          app,
          { role: "guardian", next: "/guardian" },
          { email },
        );
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe(
          "https://app.lyceon.test/profile/complete?next=%2Fguardian",
        );
        expect(await roleByEmail(email)).toBe("guardian");
      });

      it("no role leaves the new account a student, as before", async () => {
        const email = freshEmail("google-none");
        const res = await googleSignIn(app, {}, { email });
        expect(res.headers.location).toBe(
          "https://app.lyceon.test/profile/complete",
        );
        expect(await roleByEmail(email)).toBe("student");
      });

      it.each([["admin"], ["Guardian"], ["guardian\n"], ["student"]])(
        "role=%j leaves the new account a student",
        async (role) => {
          const email = freshEmail("google-unknown");
          const res = await googleSignIn(app, { role }, { email });
          expect(res.headers.location).toBe(
            "https://app.lyceon.test/profile/complete",
          );
          expect(res.status).toBe(302);
          expect(await roleByEmail(email)).toBe("student");
        },
      );

      it("a returning, completed student is never re-roled by the parameter", async () => {
        const email = freshEmail("google-returning");
        const id = randomUUID();
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')`,
          [id, email],
        );
        await pg.query(
          `UPDATE public.profiles SET profile_completed_at = now(), date_of_birth = '2008-01-01'
           WHERE id = $1`,
          [id],
        );
        expect(await roleByEmail(email)).toBe("student"); // presence before the change under test
        const res = await googleSignIn(
          app,
          { role: "guardian" },
          { email, id, createdAt: "2026-01-01T00:00:00.000Z" },
        );
        expect(res.headers.location).toBe("https://app.lyceon.test/dashboard");
        expect(await roleByEmail(email)).toBe("student");
      });

      // The one-time decision refuses on its own facts, even where the write's WHERE would allow
      // it (still a student, still not onboarded): learning state was written as a student.
      it("a new, not-onboarded account that already holds learning state is not re-roled", async () => {
        const email = freshEmail("google-state");
        const id = randomUUID();
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')`,
          [id, email],
        );
        await pg.query(
          `INSERT INTO public.student_study_profile (student_id, timezone) VALUES ($1, 'America/Chicago')`,
          [id],
        );
        const res = await googleSignIn(
          app,
          { role: "guardian" },
          { email, id },
        );
        // Presence first: the sign-in completed (an error redirect would also leave a student).
        expect(res.headers.location).toBe(
          "https://app.lyceon.test/profile/complete",
        );
        expect(res.status).toBe(302);
        expect(await roleByEmail(email)).toBe("student");
      });

      // A completion landing between the decision's read and the write: the facts said "not
      // onboarded", the row says otherwise by the time it is written. The write's own WHERE holds.
      it("the write never overwrites a profile completed after the decision read it", async () => {
        const email = freshEmail("race");
        const id = randomUUID();
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')`,
          [id, email],
        );
        await pg.query(
          `UPDATE public.profiles SET profile_completed_at = now(), date_of_birth = '2008-01-01'
           WHERE id = $1`,
          [id],
        );
        const { adoptGuardianSignupIntent } =
          await import("../../server/lib/role-choice");
        // The stale read: what the caller saw before the completion landed.
        await adoptGuardianSignupIntent(
          // The pg-backed stand-in for the service client (retention-sweep.pg.ci precedent).
          makePgSupabase(pg) as unknown as Parameters<
            typeof adoptGuardianSignupIntent
          >[0],
          { id, role: "student", profileCompletedAt: null },
          "support@example.test",
        );
        expect(await roleByEmail(email)).toBe("student");
      });

      it("the same call on a still-unfinished account does make it a guardian", async () => {
        const email = freshEmail("race-control");
        const id = randomUUID();
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')`,
          [id, email],
        );
        const { adoptGuardianSignupIntent } =
          await import("../../server/lib/role-choice");
        await adoptGuardianSignupIntent(
          // The pg-backed stand-in for the service client (retention-sweep.pg.ci precedent).
          makePgSupabase(pg) as unknown as Parameters<
            typeof adoptGuardianSignupIntent
          >[0],
          { id, role: "student", profileCompletedAt: null },
          "support@example.test",
        );
        expect(await roleByEmail(email)).toBe("guardian");
      });

      it("a just-created account that is already onboarded is not re-roled either", async () => {
        const email = freshEmail("google-completed");
        const id = randomUUID();
        await pg.query(
          `INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, '{}')`,
          [id, email],
        );
        await pg.query(
          `UPDATE public.profiles SET profile_completed_at = now(), date_of_birth = '2008-01-01'
           WHERE id = $1`,
          [id],
        );
        const res = await googleSignIn(
          app,
          { role: "guardian" },
          { email, id },
        );
        expect(res.headers.location).toBe("https://app.lyceon.test/dashboard");
        expect(res.status).toBe(302);
        expect(await roleByEmail(email)).toBe("student");
      });
    });
  },
);
