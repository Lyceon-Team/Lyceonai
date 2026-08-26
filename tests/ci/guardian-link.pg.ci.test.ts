/**
 * Guardian link surface → real PostgreSQL proof (WS-GL Phase B, §5's four exit criteria)
 *
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §36.1 Initiation; §36.2 Rate limiting and
 *        abuse controls; §36.3 Revocation | Doc-01A_V1.0, §39–§47 RateLimitLedger]
 *        | @implemented [2026-08-26]
 *
 * plain English: drives the REAL guardian routes against a REAL PostgreSQL database with the
 * real migrations applied, and prints the rows that come out. What it proves, in the order
 * WS-GL Phase B's exit criteria name them:
 *   1. `POST /api/guardian/link` reaches its handler and returns 2xx for an authenticated
 *      guardian — the defect this whole workstream exists to close was a 500 on every call.
 *   2. One guardian holds links to TWO students, both active. §35 says "one or more students";
 *      the retired 1:1 rule refused the second outright.
 *   3. Both §36.2 rate-limit buckets write real ledger rows, with a denial OBSERVED at the
 *      limit rather than inferred.
 *   4. §36.1's state machine and §36.3's revocation write every column that was previously
 *      never written: initiated_by/at, accepted_at/by, revoked_at/by, revocation_reason.
 * Trade-off: see MOCK BOUNDARY. Edge case: skips when no PG server is reachable, rather than
 * passing vacuously.
 *
 * MOCK BOUNDARY — stated because "nothing mocked" must mean something precise.
 * Substituted:
 *   - the DATABASE TRANSPORT (`supabaseServer` → real SQL via tests/helpers/pg-supabase)
 *   - the AUTH BOUNDARY (`requireSupabaseAuth` → attaches a fixture `req.user`), which is a
 *     session fixture, not a stand-in for anything this test asserts.
 * NOT substituted — every module whose behaviour is under test runs for real:
 *   - `server/middleware/guardian-link-rate-limit` (the thing that used to fail)
 *   - `packages/shared/src/services/rate-limit-ledger`
 *   - `server/lib/account`
 *   - `server/routes/guardian-routes`
 * The three existing guardian tests mock the rate limiter to a pass-through and
 * `guardian-linking.contract.test.ts` mocks `server/lib/account` wholesale, which is exactly
 * why a 500-on-every-link stayed green for the life of the surface
 * (`WS-GL_Stage1_Audit.md` §8). This test exists to not do that.
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

const DB_NAME = "wsgl_guardian_link_ci";

const GUARDIAN_ID = "11111111-1111-1111-1111-111111111111";
const STUDENT_A_ID = "22222222-2222-2222-2222-222222222222";
const STUDENT_B_ID = "33333333-3333-3333-3333-333333333333";
const STUDENT_A_EMAIL = "student.a@example.test";
const STUDENT_B_EMAIL = "student.b@example.test";

/** §36.2 launch values, seeded as fixtures. Production seeding is an owner DML action. */
const GUARDIAN_DAILY_LIMIT = 10;
const EMAIL_DAILY_LIMIT = 3;

let pg: Client;

// ---------------------------------------------------------------------------
// Transport + auth boundary. Declared before the router is imported so the
// router picks these up; nothing inside the guardian-link path is replaced.
// ---------------------------------------------------------------------------
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

// Partial mock: ONLY the auth entry point is replaced with a session fixture.
// Every other export of this module — `requireRequestUser` among them — stays real,
// so nothing downstream is silently stubbed out.
vi.mock("../../server/middleware/supabase-auth", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    requireSupabaseAuth: (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      (req as express.Request & { user?: unknown }).user = {
        id: GUARDIAN_ID,
        email: "guardian@example.test",
        role: "guardian",
      };
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
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
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
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId =
      "wsgl-phase-b";
    next();
  });
  app.use("/api/guardian", router);
  app.use(
    (
      err: Error,
      _rq: express.Request,
      rs: express.Response,
      _n: express.NextFunction,
    ) => {
      // eslint-disable-next-line no-console
      console.log(`[WS-GL §5 ERR] ${err?.stack ?? err}`);
      rs.status(500).json({ error: String(err?.message ?? err) });
    },
  );
  return app;
}

/** Print a labelled row set so the run carries its own evidence. */
async function show(label: string, sql: string): Promise<unknown[]> {
  const r = await pg.query(sql);
  // eslint-disable-next-line no-console
  console.log(`[WS-GL §5] ${label} (${r.rowCount} rows):`);
  for (const row of r.rows) {
    // eslint-disable-next-line no-console
    console.log(`  ${JSON.stringify(row)}`);
  }
  return r.rows;
}

describe.skipIf(!PG_AVAILABLE)(
  "WS-GL Phase B — real routes, real Postgres",
  () => {
    beforeAll(async () => {
      const admin = new Client(pgConnConfig("postgres"));
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      await admin.query(`CREATE DATABASE ${DB_NAME}`);
      await admin.end();

      pg = new Client(pgConnConfig(DB_NAME));
      await pg.connect();
      await applyMigrations(pg);

      // Fixture identities. `profiles.id` FKs auth.users, so both rows are needed.
      // The genesis `on_auth_user_created` trigger would pre-empt our explicit profiles
      // rows with its own default insert. Dropping it is the established pattern for gates
      // that seed auth.users directly — see scripts/ci/05b-domain-kpi-gates.sh:42. This gate
      // does not test auth profile creation; that is genesis-fresh-apply A.2/A.3.
      await pg.query(
        `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`,
      );
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2), ($3,$4), ($5,$6)`,
        [
          GUARDIAN_ID,
          "guardian@example.test",
          STUDENT_A_ID,
          STUDENT_A_EMAIL,
          STUDENT_B_ID,
          STUDENT_B_EMAIL,
        ],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role)
       VALUES ($1,$2,'guardian'), ($3,$4,'student'), ($5,$6,'student')`,
        [
          GUARDIAN_ID,
          "guardian@example.test",
          STUDENT_A_ID,
          STUDENT_A_EMAIL,
          STUDENT_B_ID,
          STUDENT_B_EMAIL,
        ],
      );

      // Bucket definitions fixture. Doc 01A Appendix A.3 is the canonical home
      // (`bucket_definitions`, a bucket_key -> { limit, window_seconds } map). The guardian
      // daily entry's 10/day is A.3's launch seed AND Doc 01 V8 §36.2's prose. The per-email
      // family's 3/day is §36.2's prose; A.3 carries no entry for it, which is recorded as an
      // SCL candidate rather than treated as canonical. Seeding HERE is fixture setup against
      // a throwaway database; production seeding is an owner DML action
      // (docs/plans/WS-GL_Stage3_Owner_DML.sql). Without it the wrapper denies with 503 by
      // design — an unconfigured bucket must not fall back to an invented number.
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
    }, 120_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    // `audit_logs` is APPEND-ONLY — a trigger refuses UPDATE and DELETE, which is the table
    // doing exactly its job. So each test records a floor timestamp and reads only rows
    // written after it, rather than truncating a tamper-evident trail to make a test tidy.
    let auditFloor: string;

    beforeEach(async () => {
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      const { rows } = await pg.query(`SELECT now()::text AS t`);
      auditFloor = rows[0].t;
    });

    /**
     * EXIT CRITERION 1 + 4 (guardian bucket).
     * Both halves are required. A 503 from an unconfigured bucket is also "not 500", and a
     * 2xx with zero ledger rows would mean the limiter never ran — the vacuous proof this
     * phase must avoid.
     */
    it("§36.1 — POST /api/guardian/link returns 2xx and writes a pending link", async () => {
      const app = await buildApp();
      const res = await request(app)
        .post("/api/guardian/link")
        .send({ email: STUDENT_A_EMAIL });

      // eslint-disable-next-line no-console
      console.log(
        `[WS-GL §5] POST /api/guardian/link → ${res.status} ${JSON.stringify(res.body)}`,
      );

      const links = await show(
        "guardian_links after initiation",
        `SELECT guardian_profile_id, student_profile_id, status, initiated_by,
              initiated_at IS NOT NULL AS initiated_at_set,
              accepted_at, accepted_by_profile_id
         FROM public.guardian_links`,
      );
      const ledger = await show(
        "rate_limit_ledger after initiation",
        `SELECT bucket_key, used_count, limit_count FROM public.rate_limit_ledger ORDER BY bucket_key`,
      );

      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);

      // §36.1: a guardian-initiated link waits on the student. It is NOT active.
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        guardian_profile_id: GUARDIAN_ID,
        student_profile_id: STUDENT_A_ID,
        status: "pending_student_accept",
        initiated_by: "guardian",
        initiated_at_set: true,
        accepted_at: null,
        accepted_by_profile_id: null,
      });

      // §36.2: BOTH controls counted this attempt.
      expect(ledger).toHaveLength(2);
      const keys = ledger.map((r) => (r as { bucket_key: string }).bucket_key);
      expect(keys).toContain("guardian_link_attempts_daily");
      expect(
        keys.some((k) => k.startsWith("guardian_link_email_attempts:")),
      ).toBe(true);
    }, 30_000);

    /**
     * EXIT CRITERION 2 — the question this workstream exists to answer.
     * §35: "Guardians are linked to one or more students". The retired 1:1 rule threw
     * GUARDIAN_ALREADY_LINKED on the second student before it reached the database.
     */
    it("§35 — one guardian holds TWO active links, each having passed through a pending state", async () => {
      const app = await buildApp();
      const { acceptGuardianLink } = await import("../../server/lib/account");

      for (const email of [STUDENT_A_EMAIL, STUDENT_B_EMAIL]) {
        const res = await request(app)
          .post("/api/guardian/link")
          .send({ email });
        expect(res.status).toBeLessThan(300);
      }

      const pending = await show(
        "guardian_links — both pending",
        `SELECT student_profile_id, status FROM public.guardian_links ORDER BY student_profile_id`,
      );
      expect(pending.map((r) => (r as { status: string }).status)).toEqual([
        "pending_student_accept",
        "pending_student_accept",
      ]);

      // §36.1 step 5: the STUDENT accepts a guardian-initiated link.
      const ids = await pg.query(
        `SELECT id, student_profile_id FROM public.guardian_links ORDER BY student_profile_id`,
      );
      for (const row of ids.rows) {
        await acceptGuardianLink(row.id, row.student_profile_id);
      }

      const active = await show(
        "guardian_links — TWO ACTIVE links for one guardian (§35)",
        `SELECT guardian_profile_id, student_profile_id, status, initiated_by,
              accepted_at IS NOT NULL AS accepted_at_set, accepted_by_profile_id
         FROM public.guardian_links WHERE status = 'active' ORDER BY student_profile_id`,
      );

      expect(active).toHaveLength(2);
      for (const row of active) {
        expect(row).toMatchObject({
          guardian_profile_id: GUARDIAN_ID,
          status: "active",
          initiated_by: "guardian",
          accepted_at_set: true,
        });
      }
      // The acceptor is the student, not the guardian — the two-step flow's whole content.
      expect(
        active.map(
          (r) =>
            (r as { accepted_by_profile_id: string }).accepted_by_profile_id,
        ),
      ).toEqual([STUDENT_A_ID, STUDENT_B_ID]);

      // §35's traceability requirement: one audit_logs row per transition.
      const audit = await show(
        "audit_logs — one row per transition",
        `SELECT action, actor_profile_id, target_profile_id FROM public.audit_logs
          WHERE created_at >= '${auditFloor}' ORDER BY created_at`,
      );
      expect(
        audit.filter(
          (r) => (r as { action: string }).action === "guardian_link_initiated",
        ),
      ).toHaveLength(2);
    }, 30_000);

    /**
     * EXIT CRITERION 4 — a denial OBSERVED at the limit, not inferred.
     * The per-email bucket (3/day) is tighter than the guardian bucket (10/day), so it is the
     * one that denies first. That also exercises the §47 rollback: the guardian bucket must
     * not have spent an attempt on a request the email bucket refused.
     */
    it("§36.2 — the per-email bucket denies at its limit, and the guardian bucket is rolled back", async () => {
      const app = await buildApp();

      const statuses: number[] = [];
      for (let i = 0; i < EMAIL_DAILY_LIMIT + 1; i++) {
        const res = await request(app)
          .post("/api/guardian/link")
          .send({ email: STUDENT_A_EMAIL });
        statuses.push(res.status);
        if (i === EMAIL_DAILY_LIMIT) {
          // eslint-disable-next-line no-console
          console.log(
            `[WS-GL §5] denial response → ${res.status} ${JSON.stringify(res.body)}`,
          );
          expect(res.headers["retry-after"]).toBeDefined();
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `[WS-GL §5] statuses across ${statuses.length} attempts: ${statuses}`,
      );

      await show(
        "rate_limit_ledger at the denied boundary",
        `SELECT bucket_key, used_count, limit_count FROM public.rate_limit_ledger ORDER BY bucket_key`,
      );

      // What the limiter governs is whether the request REACHES the handler, not what the
      // handler then decides. Attempts 2 and 3 are 409s — the pair already has a pending
      // link from attempt 1 — and a 409 is proof the limiter let them through. Only the
      // 4th is refused by the limiter itself.
      expect(statuses.slice(0, EMAIL_DAILY_LIMIT).some((s) => s === 429)).toBe(
        false,
      );
      expect(statuses[EMAIL_DAILY_LIMIT]).toBe(429);

      const rows = await pg.query(
        `SELECT bucket_key, used_count, limit_count FROM public.rate_limit_ledger ORDER BY bucket_key`,
      );
      const guardianRow = rows.rows.find(
        (r) => r.bucket_key === "guardian_link_attempts_daily",
      );
      const emailRow = rows.rows.find((r) =>
        String(r.bucket_key).startsWith("guardian_link_email_attempts:"),
      );

      expect(emailRow).toBeDefined();
      expect(emailRow.limit_count).toBe(EMAIL_DAILY_LIMIT);
      expect(emailRow.used_count).toBe(EMAIL_DAILY_LIMIT);

      // §47 rollback: 4 requests reached the guardian bucket, but the 4th was refused by the
      // email bucket and its increment was returned. Without the rollback this reads 4.
      expect(guardianRow).toBeDefined();
      expect(guardianRow.limit_count).toBe(GUARDIAN_DAILY_LIMIT);
      expect(guardianRow.used_count).toBe(EMAIL_DAILY_LIMIT);

      // The raw address never reaches a retained ledger row.
      expect(String(emailRow.bucket_key)).not.toContain(STUDENT_A_EMAIL);
      expect(String(emailRow.bucket_key)).not.toContain("@");
    }, 30_000);

    /**
     * EXIT CRITERION 4 (continued) + §36.3.
     * Revocation writes the three columns that were previously never written, and the
     * revoker is recorded rather than assumed.
     */
    it("§36.3 — revocation records revoked_at, revoked_by_profile_id and revocation_reason", async () => {
      const app = await buildApp();
      const { acceptGuardianLink } = await import("../../server/lib/account");

      await request(app)
        .post("/api/guardian/link")
        .send({ email: STUDENT_A_EMAIL });
      const created = await pg.query(
        `SELECT id FROM public.guardian_links WHERE student_profile_id = $1`,
        [STUDENT_A_ID],
      );
      await acceptGuardianLink(created.rows[0].id, STUDENT_A_ID);

      const res = await request(app)
        .delete(`/api/guardian/link/${STUDENT_A_ID}`)
        .send({ reason: "no longer required" });

      // eslint-disable-next-line no-console
      console.log(`[WS-GL §5] DELETE /api/guardian/link → ${res.status}`);

      const revoked = await show(
        "guardian_links — revoked row (§36.3)",
        `SELECT status, revoked_at IS NOT NULL AS revoked_at_set, revoked_by_profile_id,
              revocation_reason
         FROM public.guardian_links WHERE student_profile_id = '${STUDENT_A_ID}'`,
      );
      const audit = await show(
        "audit_logs — the revocation transition",
        `SELECT action, actor_profile_id, target_profile_id, changes
         FROM public.audit_logs
        WHERE action = 'guardian_link_revoked' AND created_at >= '${auditFloor}'`,
      );

      expect(res.status).toBe(200);
      expect(revoked).toHaveLength(1);
      expect(revoked[0]).toMatchObject({
        status: "revoked",
        revoked_at_set: true,
        revoked_by_profile_id: GUARDIAN_ID,
        revocation_reason: "no longer required",
      });
      expect(audit).toHaveLength(1);

      // Revocation is immediate: the guardian's active-link list is now empty.
      const stillActive = await pg.query(
        `SELECT count(*)::int AS c FROM public.guardian_links
        WHERE guardian_profile_id = $1 AND status = 'active'`,
        [GUARDIAN_ID],
      );
      expect(stillActive.rows[0].c).toBe(0);
    }, 30_000);
  },
);
