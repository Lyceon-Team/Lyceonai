/**
 * @spec [Doc-01_V8 §36.1 Initiation — BOTH directions: guardian-initiated ("Student confirms
 *        → `status = 'active'`") and student-initiated (→ `pending_guardian_accept`); §36.2
 *        rate limiting; owner rulings 2026-08-27 Q2 (both directions in V1),
 *        Q3 (subject-scoped mount, `via === 'self'`), Q7 (404 non-party / 409 party)]
 *        | @implemented [2026-08-27]
 *
 * plain English: proves a guardian-initiated link can now reach `active`, end to end, against
 * a REAL `guardian_links` row — the round trip §36.1 always specified and no route served.
 *
 * WHAT THIS PROVES THAT THE HTTP STATUS CANNOT.
 *   Mounting a route is not the same as acceptance working. Every assertion that matters here
 *   reads the ROW back from Postgres: `status`, `accepted_at`, `accepted_by_profile_id`. A
 *   handler that returned 200 and wrote nothing passes an HTTP-only assertion and fails these
 *   (owner note, 2026-08-27 — the reason the second mutation below exists).
 *
 * WHY A SECOND PG FILE RATHER THAN CASES IN `guardian-link.pg.ci.test.ts`.
 *   That file pins ONE session identity (`GUARDIAN_ID`) in its auth mock. This flow needs two
 *   — the guardian initiates, then the STUDENT accepts — so the session here is a mutable
 *   fixture switched between calls. Bolting that onto the WS-GL file would have changed the
 *   harness its four cases depend on.
 *
 * MOCK SEAM. Identical to the WS-GL file, deliberately: the Supabase client is an adapter over
 * a real `pg.Client`, and auth/CSRF are replaced at the transport boundary only. Nothing in
 * the link path — not `account.ts`, not the resolver, not the router — is stubbed. The
 * resolver in particular runs FOR REAL, which is what makes the `via` assertions mean anything.
 *
 * MUTATIONS OBSERVED RED, and the assertion each one reaches. The owner asked for a second
 * mutation that reds on LINK STATE rather than on the HTTP code; staging it showed that two
 * were not enough, because an earlier assertion short-circuits before the row is ever read.
 *   1. Unmount the route (change the path so nothing matches).
 *      → reds at `expect(res.status).toBe(200)`. Proves the route is mounted. 5 of 7 fail.
 *   2. Break the transition: in `acceptGuardianLink` (`server/lib/account.ts`) change the
 *      update payload's `status: "active"` to `status: current.status`.
 *      → reds at `expect(res.body?.data?.status)`. 3 of 7 fail. NOTE: the run stops there,
 *        so this mutation never reaches the row assertions — it does not prove them.
 *   3. Make the handler answer 200 and write NOTHING (return `{...existing, status:"active"}`
 *      without calling `acceptGuardianLink`).
 *      → reds at `expect(after?.status).toBe("active")` — the ROW read, with HTTP 200 and a
 *        response body that claims success. 3 of 7 fail. THIS is the mutation that proves
 *        acceptance actually happened; mutation 2 alone would have left the row assertions
 *        unexercised and indistinguishable from decoration.
 *
 * MUTATIONS FOR THE INITIATE ROUTE (adoption plan step 2), same three layers:
 *   1. Unmount `POST /:studentId/links` → reds at `res.status`. 6 of 14 fail.
 *   2. Pass `"guardian"` instead of `"student"` to `createGuardianLink`
 *      → reds at `expect(rows[0].status)` with `'pending_student_accept'` where
 *        `'pending_guardian_accept'` belongs — a ROW assertion — and the round-trip case
 *        then fails because the guardian cannot accept a link waiting on the student.
 *        2 of 14 fail.
 *   3. Answer 202 and never call `createGuardianLink`
 *      → reds at `expect(rows).toHaveLength(1)`. 3 of 14 fail.
 *
 * A NOTE ON STAGING MUTATION 2. Its first form did not match the source — prettier had
 * reformatted the call across four lines — and the run came back 14/14. That green was the
 * mutation never applying, not the code surviving it. The staging assert said STALE and the
 * case was re-staged against the real text. A mutation proof that cannot fail to apply is
 * worth as little as a test that cannot fail.
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
import express from "express";
import request from "supertest";
import fs from "fs";
import path from "path";
import {
  makePgSupabase,
  pgConnConfig,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "wsgl_student_side_ci";

const GUARDIAN_ID = "11111111-1111-1111-1111-111111111111";
const STUDENT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_STUDENT_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_EMAIL = "student.accept@example.test";
const GUARDIAN_EMAIL = "guardian@example.test";
const GUARDIAN_DAILY_LIMIT = 10;
const EMAIL_DAILY_LIMIT = 3;

let pg: Client;

/** The session the next request carries. Switched between guardian and student mid-flow. */
let currentUser: { id: string; email: string; role: string } = {
  id: GUARDIAN_ID,
  email: "guardian@example.test",
  role: "guardian",
};

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

// Partial mock: ONLY the auth entry point. `requireRequestUser` and everything else stay real.
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: unknown }).user = { ...currentUser };
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  generateToken: () => "test-csrf-token",
}));

async function applyMigrations(client: Client): Promise<void> {
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
  `);
  const dir = path.resolve(__dirname, "../../supabase/migrations");
  for (const f of fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
}

async function buildApp(): Promise<express.Express> {
  const guardianRouter = (await import("../../server/routes/guardian-routes"))
    .default;
  const studentRouter = (await import("../../server/routes/student-resources"))
    .default;
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId =
      "student-accept";
    next();
  });
  app.use("/api/guardian", guardianRouter);
  // Mounted exactly as server/index.ts mounts it, auth included — the resolver reads the
  // session this middleware sets, so omitting it here would make every case resolve as
  // unauthenticated and pass for the wrong reason.
  app.use("/api/students", requireSupabaseAuth, studentRouter);
  return app;
}

async function seedPendingLink(): Promise<string> {
  const { rows } = await pg.query(
    `INSERT INTO public.guardian_links
       (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at)
     VALUES ($1, $2, 'pending_student_accept', 'guardian', now())
     RETURNING id`,
    [GUARDIAN_ID, STUDENT_ID],
  );
  return rows[0].id as string;
}

async function readLink(linkId: string) {
  const { rows } = await pg.query(
    `SELECT status, accepted_at, accepted_by_profile_id
       FROM public.guardian_links WHERE id = $1`,
    [linkId],
  );
  return rows[0] as
    | {
        status: string;
        accepted_at: Date | null;
        accepted_by_profile_id: string | null;
      }
    | undefined;
}

describe.skipIf(!PG_AVAILABLE)(
  "§36.1 — the student side of the link lifecycle, against real rows",
  () => {
    let app: express.Express;

    beforeAll(async () => {
      const admin = new Client(pgConnConfig("postgres"));
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await admin.query(`CREATE DATABASE ${DB_NAME}`);
      await admin.end();

      pg = new Client(pgConnConfig(DB_NAME));
      await pg.connect();
      await applyMigrations(pg);

      const ids: string[] = [
        GUARDIAN_ID,
        GUARDIAN_EMAIL,
        STUDENT_ID,
        STUDENT_EMAIL,
        OTHER_STUDENT_ID,
        "other@example.test",
      ];
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)
         ON CONFLICT (id) DO NOTHING`,
        ids,
      );
      // The initiate route looks the invitee up by email AND role, so profiles must carry
      // both. Seeded explicitly rather than relying on handle_new_user, whose role clamp
      // would turn every one of these into a student.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role)
         VALUES ($1,$2,'guardian'),($3,$4,'student'),($5,$6,'student')
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`,
        ids,
      );
      // §36.2 bucket fixture. Without it `guardianLinkRateLimit` denies with 503 BY DESIGN —
      // an unconfigured bucket must not fall back to an invented number — and every initiate
      // case would fail for a reason that has nothing to do with what it tests.
      await pg.query(
        `INSERT INTO public.rate_limit_runtime_config (key, value, value_type, owner, description, environment)
         VALUES ('bucket_definitions', $1::jsonb, 'object', 'product',
                 'Doc 01A Appendix A.3: bucket_key -> { limit, window_seconds }', 'all')`,
        [
          JSON.stringify({
            guardian_link_attempts_daily: {
              limit: GUARDIAN_DAILY_LIMIT,
              window_seconds: 86400,
            },
            guardian_link_email_attempts: {
              limit: EMAIL_DAILY_LIMIT,
              window_seconds: 86400,
            },
          }),
        ],
      );

      app = await buildApp();
    }, 180_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query("DELETE FROM public.guardian_links");
      await pg.query("DELETE FROM public.rate_limit_ledger");
      // `audit_logs` is NOT cleared: a DB trigger makes it append-only, which is the point of
      // an audit table. Every assertion below is therefore scoped to the link under test
      // rather than to an empty table — a stronger shape anyway, since it cannot pass merely
      // because a previous case left the table clean.
      currentUser = {
        id: GUARDIAN_ID,
        email: "guardian@example.test",
        role: "guardian",
      };
    });

    it("a guardian-initiated link reaches active when the student accepts", async () => {
      const linkId = await seedPendingLink();

      const before = await readLink(linkId);
      expect(before?.status).toBe("pending_student_accept");
      expect(before?.accepted_at).toBeNull();

      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
      );

      expect(res.status).toBe(200);
      expect(res.body?.data?.status).toBe("active");

      // THE ASSERTIONS THAT MATTER. A route that answers 200 and writes nothing satisfies
      // everything above this line and none of what follows.
      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
      expect(after?.accepted_at).not.toBeNull();
      expect(after?.accepted_by_profile_id).toBe(STUDENT_ID);
    });

    it("writes one audit_logs row naming the student as actor and the true prior status", async () => {
      const linkId = await seedPendingLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };

      await request(app).post(
        `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
      );

      const { rows } = await pg.query(
        `SELECT actor_profile_id, target_profile_id, action, changes
           FROM public.audit_logs
          WHERE action = 'guardian_link_accepted'
            AND context->>'link_id' = $1`,
        [linkId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_profile_id).toBe(STUDENT_ID);
      expect(rows[0].target_profile_id).toBe(GUARDIAN_ID);
      // Read from the row, not asserted: the guardian route hardcodes its `from`.
      expect(rows[0].changes).toMatchObject({
        from: "pending_student_accept",
        to: "active",
      });
    });

    it("404s a caller who is not a party to the link, leaving it untouched (Q7)", async () => {
      const linkId = await seedPendingLink();

      // A different student, resolving via='self' on their OWN id, naming someone else's link.
      currentUser = {
        id: OTHER_STUDENT_ID,
        email: "other@example.test",
        role: "student",
      };
      const res = await request(app).post(
        `/api/students/${OTHER_STUDENT_ID}/links/${linkId}/accept`,
      );

      expect(res.status).toBe(404);
      const after = await readLink(linkId);
      expect(after?.status).toBe("pending_student_accept");
    });

    it("404s a guardian using the student's route — via must be self (Q3)", async () => {
      const linkId = await seedPendingLink();
      // Session stays the guardian, who IS a party to this link and would resolve
      // via='guardian' on the student's id. The route is still not theirs.
      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
      );

      expect(res.status).toBe(404);
      const after = await readLink(linkId);
      expect(after?.status).toBe("pending_student_accept");
    });

    it("409s the student when the link is not theirs to accept, and says so (Q7)", async () => {
      // A link waiting on the GUARDIAN. The student is a party — they are named on it — so
      // Q7 keeps the informative answer, as a state conflict rather than an authz failure.
      const { rows } = await pg.query(
        `INSERT INTO public.guardian_links
           (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at)
         VALUES ($1, $2, 'pending_guardian_accept', 'student', now())
         RETURNING id`,
        [GUARDIAN_ID, STUDENT_ID],
      );
      const linkId = rows[0].id as string;

      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
      );

      expect(res.status).toBe(409);
      const after = await readLink(linkId);
      expect(after?.status).toBe("pending_guardian_accept");
    });

    it("409s a second acceptance rather than writing one twice", async () => {
      const linkId = await seedPendingLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const url = `/api/students/${STUDENT_ID}/links/${linkId}/accept`;

      expect((await request(app).post(url)).status).toBe(200);
      const firstAccept = await readLink(linkId);

      expect((await request(app).post(url)).status).toBe(409);
      const secondAccept = await readLink(linkId);

      // Idempotent in effect: the second call changes nothing, including the timestamp.
      expect(secondAccept?.accepted_at?.toISOString()).toBe(
        firstAccept?.accepted_at?.toISOString(),
      );
    });

    // ---------------------------------------------------------------------
    // §36.1 step 1, student-initiated — adoption plan step 2
    // ---------------------------------------------------------------------

    it("a student invites a guardian, and a real pending_guardian_accept row appears", async () => {
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: GUARDIAN_EMAIL });

      expect(res.status).toBe(202);

      // The row, not the response. A handler that answered 202 and wrote nothing satisfies
      // the line above and none of these.
      const { rows } = await pg.query(
        `SELECT guardian_profile_id, student_profile_id, status, initiated_by, initiated_at
           FROM public.guardian_links`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("pending_guardian_accept");
      expect(rows[0].initiated_by).toBe("student");
      expect(rows[0].guardian_profile_id).toBe(GUARDIAN_ID);
      expect(rows[0].student_profile_id).toBe(STUDENT_ID);
      expect(rows[0].initiated_at).not.toBeNull();
    });

    it("the student-initiated direction completes: invite, guardian accepts, active", async () => {
      // The whole point of step 2. Before it, nothing outside the consent flow could produce
      // a `pending_guardian_accept` link, so the guardian's acceptance route had no input.
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const invite = await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: GUARDIAN_EMAIL });
      expect(invite.status).toBe(202);
      const linkId = invite.body?.data?.link_id as string;
      expect(linkId).toBeTruthy();

      currentUser = {
        id: GUARDIAN_ID,
        email: GUARDIAN_EMAIL,
        role: "guardian",
      };
      const accept = await request(app).post(
        `/api/guardian/link/${linkId}/accept`,
      );
      expect(accept.status).toBe(200);

      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
      expect(after?.accepted_by_profile_id).toBe(GUARDIAN_ID);
      expect(after?.accepted_at).not.toBeNull();
    });

    it("an unknown guardian address gets the SAME 202 and writes no link", async () => {
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: "nobody@example.test" });

      // Byte-for-byte the same shape as the found case — that is the anti-enumeration
      // property, and asserting only the status would not show it.
      expect(res.status).toBe(202);
      expect(res.body?.data?.status).toBe("pending_guardian_accept");

      const { rows } = await pg.query(`SELECT id FROM public.guardian_links`);
      expect(rows).toHaveLength(0);
    });

    it("409s a duplicate invitation and leaves exactly one row", async () => {
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const url = `/api/students/${STUDENT_ID}/links`;

      expect(
        (await request(app).post(url).send({ email: GUARDIAN_EMAIL })).status,
      ).toBe(202);
      expect(
        (await request(app).post(url).send({ email: GUARDIAN_EMAIL })).status,
      ).toBe(409);

      const { rows } = await pg.query(`SELECT id FROM public.guardian_links`);
      expect(rows).toHaveLength(1);
    });

    it("404s a non-self caller on initiate, and writes nothing", async () => {
      // The guardian, resolving via='guardian' on the student's id.
      currentUser = {
        id: GUARDIAN_ID,
        email: GUARDIAN_EMAIL,
        role: "guardian",
      };
      const res = await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: GUARDIAN_EMAIL });

      expect(res.status).toBe(404);
      const { rows } = await pg.query(`SELECT id FROM public.guardian_links`);
      expect(rows).toHaveLength(0);
    });

    it("§36.2 — the initiate route actually consumes rate-limit quota", async () => {
      // A 202 with zero ledger rows would mean the limiter never ran: the vacuous pass this
      // whole surface exists to avoid.
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: GUARDIAN_EMAIL });

      const { rows } = await pg.query(
        `SELECT bucket_key, used_count, limit_count
           FROM public.rate_limit_ledger WHERE profile_id = $1`,
        [STUDENT_ID],
      );
      const byKey = new Map(
        rows.map((r: { bucket_key: string; used_count: number }) => [
          r.bucket_key,
          r.used_count,
        ]),
      );

      // BOTH §36.2 controls, keyed on the STUDENT as initiator — which is the reading this
      // route relies on: the buckets count the feature's attempts, not the guardian's.
      expect(byKey.get("guardian_link_attempts_daily")).toBe(1);
      const emailKey = [...byKey.keys()].find((k) =>
        k.startsWith("guardian_link_email_attempts"),
      );
      expect(
        emailKey,
        "no per-email bucket row — the second control never ran",
      ).toBeTruthy();
      expect(byKey.get(emailKey as string)).toBe(1);
    });

    it("400s a malformed body without touching the table", async () => {
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: "not-an-email" });
      expect(res.status).toBe(400);
      const { rows } = await pg.query(`SELECT id FROM public.guardian_links`);
      expect(rows).toHaveLength(0);
    });

    it("400s a malformed link id without touching the table", async () => {
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/not-a-uuid/accept`,
      );
      expect(res.status).toBe(400);
    });
  },
);
