/**
 * @spec [Doc-01_V8 §36.1 Initiation — guardian-initiated: "Student confirms →
 *        `status = 'active'`"; owner rulings 2026-08-27 Q2 (both directions in V1),
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
 *        acceptance actually happened; mutation 2 alone would have left lines 240-243
 *        unexercised and indistinguishable from decoration.
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

const DB_NAME = "wsgl_student_accept_ci";

const GUARDIAN_ID = "11111111-1111-1111-1111-111111111111";
const STUDENT_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_STUDENT_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_EMAIL = "student.accept@example.test";

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
  "§36.1 — the student side of acceptance, against real rows",
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

      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          GUARDIAN_ID,
          "guardian@example.test",
          STUDENT_ID,
          STUDENT_EMAIL,
          OTHER_STUDENT_ID,
          "other@example.test",
        ],
      );

      app = await buildApp();
    }, 180_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      await pg.query("DELETE FROM public.guardian_links");
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

    it("400s a malformed link id without touching the table", async () => {
      currentUser = { id: STUDENT_ID, email: STUDENT_EMAIL, role: "student" };
      const res = await request(app).post(
        `/api/students/${STUDENT_ID}/links/not-a-uuid/accept`,
      );
      expect(res.status).toBe(400);
    });
  },
);
