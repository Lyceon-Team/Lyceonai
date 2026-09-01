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
 *
 * MUTATIONS FOR THE REVOKE ROUTE (adoption plan step 3):
 *   1. Unmount `DELETE /:studentId/links/:linkId` → reds at `res.status`. 5 of 21 fail.
 *   2. Pass the guardian as `revokedByProfileId` instead of the student
 *      → reds at `expect(rows[0].revoked_by_profile_id)` — the guardian's id where the
 *        student's belongs. 1 of 21. This is §36.3's entire content: the revoker is
 *        RECORDED, not assumed.
 *   3. Answer 200 and never call `revokeGuardianLink`
 *      → reds at the row `status` AND at `guardian_view_decision`. 3 of 21.
 *
 * AND ONE THAT PROVES THE `via` GUARD, ACROSS ALL THREE ROUTES:
 *   0. Replace `if (subject.via !== "self")` with `if (false)`
 *      → reds exactly the two "a guardian on the student's route" cases. 2 of 21.
 *
 * WHY MUTATION 0 MATTERS MORE THAN IT LOOKS, AND WHAT IT CAUGHT.
 *   Both of those cases were originally written against a PENDING link with no entitlement.
 *   In that state `guardian_view_decision` answers `not_linked`, so the RESOLVER replied 404
 *   and the case passed — green, asserting the right number, having never executed the guard
 *   it names. Mutation 0 would have left them green. They now seed an ACTIVE link AND an
 *   active entitlement, assert `viewDecision() === "allow"` first to prove the guardian really
 *   does resolve as via='guardian', and only then call the route. Without the guard the accept
 *   case would be 409 and the revoke case would SUCCEED, so both discriminate sharply.
 *
 *   This is the same defect as a stale mutation, wearing the opposite mask: there, a proof
 *   that could not fail to apply; here, an assertion that could not fail to pass.
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

async function seedActiveLink(): Promise<string> {
  const { rows } = await pg.query(
    `INSERT INTO public.guardian_links
       (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at, accepted_by_profile_id)
     VALUES ($1, $2, 'active', 'guardian', now(), now(), $2)
     RETURNING id`,
    [GUARDIAN_ID, STUDENT_ID],
  );
  return rows[0].id as string;
}

/**
 * An ACTIVE entitlement for the student.
 *
 * Required by any case that means to exercise the route's own `via !== "self"` guard: without
 * it `guardian_view_decision` answers `student_unentitled` and the RESOLVER replies 402 before
 * the handler runs, so the case would assert a denial the route never produced.
 */
async function seedEntitlement(): Promise<void> {
  await pg.query(
    `INSERT INTO public.entitlements (profile_id, tier, status)
     VALUES ($1, 'premium', 'active')
     ON CONFLICT (profile_id) DO UPDATE SET status = 'active'`,
    [STUDENT_ID],
  );
}

async function viewDecision(): Promise<string> {
  const { rows } = await pg.query(
    `SELECT public.guardian_view_decision($1, $2) AS d`,
    [GUARDIAN_ID, STUDENT_ID],
  );
  return rows[0].d as string;
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
      await pg.query("DELETE FROM public.entitlements");
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
      // THE SETUP IS THE POINT. An earlier draft seeded only a PENDING link, so
      // `guardian_view_decision` answered `not_linked`, the resolver replied 404, and the
      // case passed without the route's own `via` guard ever running — green for a reason
      // that had nothing to do with what it claims to test. Reaching that guard requires the
      // guardian to resolve as via='guardian', which needs an ACTIVE link AND an active
      // student entitlement.
      const linkId = await seedActiveLink();
      await seedEntitlement();
      expect(await viewDecision()).toBe("allow");

      // Session stays the guardian. Without the `via` guard this is 409 (an active link is
      // not pending); with it, 404. The two are distinguishable, which is what makes the
      // case mean something.
      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
      );

      expect(res.status).toBe(404);
      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
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

    it("404s a non-self caller on initiate — via must be self", async () => {
      // THIRD instance of the same defect, found by retro-audit. As first written this case
      // seeded no link at all, so `guardian_view_decision` answered `not_linked`, the
      // RESOLVER replied 404, and the route's own `via` guard never ran — while the comment
      // claimed "resolving via='guardian'", which was exactly the mechanism it did not
      // exercise. Mutation 0 (disable the guard) left it green, which is how it was caught.
      const linkId = await seedActiveLink();
      await seedEntitlement();
      expect(await viewDecision()).toBe("allow");

      currentUser = {
        id: GUARDIAN_ID,
        email: GUARDIAN_EMAIL,
        role: "guardian",
      };
      const res = await request(app)
        .post(`/api/students/${STUDENT_ID}/links`)
        .send({ email: GUARDIAN_EMAIL });

      // Without the guard the guardian reaches `createGuardianLink` and the active link
      // above makes it 409 — so 404-versus-409 is what discriminates here, and the privilege
      // the guard actually withholds is a guardian manufacturing a student-initiated link on
      // the student's behalf.
      expect(res.status).toBe(404);
      const { rows } = await pg.query(`SELECT id FROM public.guardian_links`);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(linkId);
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

    // ---------------------------------------------------------------------
    // §36.3 revocation, student half — adoption plan step 3
    // ---------------------------------------------------------------------

    it("a student revokes an active link, and the row records THEM as revoker", async () => {
      const linkId = await seedActiveLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };

      const res = await request(app)
        .delete(`/api/students/${STUDENT_ID}/links/${linkId}`)
        .send({ reason: "I no longer want this" });

      expect(res.status).toBe(200);

      const { rows } = await pg.query(
        `SELECT status, revoked_at, revoked_by_profile_id, revocation_reason
           FROM public.guardian_links WHERE id = $1`,
        [linkId],
      );
      expect(rows[0].status).toBe("revoked");
      expect(rows[0].revoked_at).not.toBeNull();
      // §36.3's whole point: the revoker is RECORDED, not assumed to be the guardian.
      expect(rows[0].revoked_by_profile_id).toBe(STUDENT_ID);
      expect(rows[0].revocation_reason).toBe("I no longer want this");
    });

    it("revocation actually ends guardian visibility, per the live SQL decision", async () => {
      // The assertion that matters for safeguarding. A `status` column changing is a
      // database fact; this asks the function every guardian read gate calls, and it is the
      // one PR 1 shipped and the advisor verified on prod.
      const linkId = await seedActiveLink();

      // Linked but unentitled — which also shows the ordering: the link is checked FIRST,
      // so an unlinked caller never learns anything about billing state.
      expect(await viewDecision()).toBe("student_unentitled");

      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      await request(app).delete(`/api/students/${STUDENT_ID}/links/${linkId}`);

      expect(await viewDecision()).toBe("not_linked");
    });

    it("stores a null reason when none is given", async () => {
      const linkId = await seedActiveLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };

      const res = await request(app).delete(
        `/api/students/${STUDENT_ID}/links/${linkId}`,
      );
      expect(res.status).toBe(200);

      const { rows } = await pg.query(
        `SELECT revocation_reason FROM public.guardian_links WHERE id = $1`,
        [linkId],
      );
      expect(rows[0].revocation_reason).toBeNull();
    });

    it("400s an over-long reason rather than silently truncating it", async () => {
      const linkId = await seedActiveLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };

      const res = await request(app)
        .delete(`/api/students/${STUDENT_ID}/links/${linkId}`)
        .send({ reason: "x".repeat(201) });

      expect(res.status).toBe(400);
      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
    });

    it("404s a non-party revoker, leaving the link active", async () => {
      const linkId = await seedActiveLink();
      currentUser = {
        id: OTHER_STUDENT_ID,
        email: "other@example.test",
        role: "student",
      };

      const res = await request(app).delete(
        `/api/students/${OTHER_STUDENT_ID}/links/${linkId}`,
      );
      expect(res.status).toBe(404);
      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
    });

    it("404s a guardian on the student's revoke route — via must be self", async () => {
      const linkId = await seedActiveLink();
      await seedEntitlement();
      // Same correction as the accept case: without the entitlement the resolver answers 402
      // and the route's own guard never runs.
      expect(await viewDecision()).toBe("allow");

      // Session stays the guardian, who has their own revoke route. Without the `via` guard
      // this call SUCCEEDS and revokes the link, so the case discriminates sharply.
      const res = await request(app).delete(
        `/api/students/${STUDENT_ID}/links/${linkId}`,
      );
      expect(res.status).toBe(404);
      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
    });

    it("409s a second revocation rather than writing one twice", async () => {
      const linkId = await seedActiveLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const url = `/api/students/${STUDENT_ID}/links/${linkId}`;

      expect((await request(app).delete(url)).status).toBe(200);
      const first = await pg.query(
        `SELECT revoked_at FROM public.guardian_links WHERE id = $1`,
        [linkId],
      );

      expect((await request(app).delete(url)).status).toBe(409);
      const second = await pg.query(
        `SELECT revoked_at FROM public.guardian_links WHERE id = $1`,
        [linkId],
      );
      expect(second.rows[0].revoked_at.toISOString()).toBe(
        first.rows[0].revoked_at.toISOString(),
      );
    });

    // ---------------------------------------------------------------------
    // Fail-closed: the transition and its audit row are ONE transaction — step 4
    // ---------------------------------------------------------------------

    it("FAIL-CLOSED: a failing audit insert leaves the link UNACCEPTED", async () => {
      // The requirement, in the owner's words: the proof must red on LINK STATE, not on the
      // audit row or the status code. A test that only asserts a 500 proves the route errored,
      // not that the write was prevented — and "500 with an active link and no audit row" is
      // the outcome that is worse than either posture alone.
      //
      // The audit insert is broken at the DATABASE, not by mocking the writer: the whole claim
      // is that Postgres rolls the pair back together, and a mocked writer would prove nothing
      // about that.
      const linkId = await seedPendingLink();
      // NOT VALID: enforced on every new INSERT, but not validated against rows already
      // there. `audit_logs` is append-only and earlier cases in this run have written accept
      // rows, so a validating constraint cannot be added at all — and the point here is to
      // break the NEXT insert, not to make a claim about history.
      await pg.query(
        `ALTER TABLE public.audit_logs
           ADD CONSTRAINT tmp_reject_accept
           CHECK (action <> 'guardian_link_accepted') NOT VALID`,
      );

      try {
        currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
        const res = await request(app).post(
          `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
        );
        expect(res.status).toBe(500);

        // THE ASSERTIONS THAT MATTER — the link did not move.
        const after = await readLink(linkId);
        expect(after?.status).toBe("pending_student_accept");
        expect(after?.accepted_at).toBeNull();
        expect(after?.accepted_by_profile_id).toBeNull();

        const { rows } = await pg.query(
          `SELECT id FROM public.audit_logs
            WHERE action = 'guardian_link_accepted' AND context->>'link_id' = $1`,
          [linkId],
        );
        expect(rows).toHaveLength(0);
      } finally {
        await pg.query(
          `ALTER TABLE public.audit_logs DROP CONSTRAINT tmp_reject_accept`,
        );
      }
    });

    it("FAIL-CLOSED: with the audit insert repaired, the same accept succeeds", async () => {
      // The positive half. Without it, a route that ALWAYS 500'd would satisfy the case above.
      const linkId = await seedPendingLink();
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };

      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/${linkId}/accept`,
      );
      expect(res.status).toBe(200);

      const after = await readLink(linkId);
      expect(after?.status).toBe("active");
      const { rows } = await pg.query(
        `SELECT id FROM public.audit_logs
          WHERE action = 'guardian_link_accepted' AND context->>'link_id' = $1`,
        [linkId],
      );
      expect(rows).toHaveLength(1);
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
