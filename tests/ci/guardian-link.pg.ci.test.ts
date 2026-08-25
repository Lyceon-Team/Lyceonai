/**
 * Guardian link route → real PostgreSQL proof (WS-GL Stage 3, §9's first test)
 *
 * @spec [Doc-01_V8, §35 Guardian-student linkage; §36.1 Initiation; §36.2 Rate
 *        limiting and abuse controls | Doc-01A_V1.0, §39–§47 RateLimitLedger]
 *        | @implemented [2026-08-25]
 *
 * plain English: drives the real `POST /api/guardian/link` route against a real
 * PostgreSQL database with the real migrations applied, and asserts it does not
 * return 500 for an authenticated guardian. Expected outcome, per
 * `docs/plans/WS-GL_Stage1_Audit.md` §0: it FAILS today, because the route mounts
 * `durableRateLimiter` before its handler and that middleware counts rows in
 * `guardian_link_audit`, a table that does not exist. Its red-to-green transition is
 * the only evidence that this surface works — a passing unit test is not.
 * Trade-off: see MOCK BOUNDARY. Edge case: skips when no PG server is reachable,
 * rather than passing vacuously.
 *
 * MOCK BOUNDARY — stated because "nothing mocked" must mean something precise.
 * Substituted:
 *   - the DATABASE TRANSPORT (`supabaseServer` → real SQL via tests/helpers/pg-supabase)
 *   - the AUTH BOUNDARY (`requireSupabaseAuth` → attaches a fixture `req.user`),
 *     which is a session fixture, not a stand-in for anything this test asserts.
 * NOT substituted — every module whose behaviour is under test runs for real:
 *   - `server/lib/durable-rate-limiter` (the thing that fails)
 *   - `server/lib/account`
 *   - `server/routes/guardian-routes`
 * The three existing guardian tests mock `durable-rate-limiter` to a pass-through,
 * which is exactly why a 500-on-every-link stayed green for the life of the surface
 * (`WS-GL_Stage1_Audit.md` §8). This test exists to not do that.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
const STUDENT_A_CODE = "STUDENTA";

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

describe.skipIf(!PG_AVAILABLE)(
  "POST /api/guardian/link — real route, real Postgres",
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
      // The genesis `on_auth_user_created` trigger would pre-empt our explicit
      // profiles rows with its own default insert. Dropping it is the established
      // pattern for gates that seed auth.users directly — see
      // scripts/ci/05b-domain-kpi-gates.sh:42. This gate does not test auth profile
      // creation; that is genesis-fresh-apply A.2/A.3.
      await pg.query(
        `DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;`,
      );
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2), ($3,$4)`,
        [
          GUARDIAN_ID,
          "guardian@example.test",
          STUDENT_A_ID,
          "student.a@example.test",
        ],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, student_link_code)
         VALUES ($1,$2,'guardian',NULL), ($3,$4,'student',$5)`,
        [
          GUARDIAN_ID,
          "guardian@example.test",
          STUDENT_A_ID,
          "student.a@example.test",
          STUDENT_A_CODE,
        ],
      );

      // Bucket definition fixture. Doc 01A Appendix A.3 is the canonical home
      // (`bucket_definitions`, a bucket_key -> { limit, window_seconds } map) and its
      // launch seed states `guardian_link_attempts_daily: { limit: 10,
      // window_seconds: 86400 }` — the same 10/day Doc 01 V8 §36.2 states in prose.
      // Seeding it HERE is test fixture setup against a throwaway database; the
      // production seed is an owner DML action (docs/plans/WS-GL_Stage3_Owner_DML.sql).
      // Without it the wrapper denies with 503 by design — an unconfigured bucket
      // must not fall back to an invented number.
      await pg.query(
        `INSERT INTO public.rate_limit_runtime_config (key, value, value_type, owner, description, environment)
         VALUES ('bucket_definitions',
                 '{"guardian_link_attempts_daily": {"limit": 10, "window_seconds": 86400}}'::jsonb,
                 'object', 'product',
                 'Doc 01A Appendix A.3: bucket_key -> { limit, window_seconds }', 'all')`,
      );
    }, 120_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    it("does not return 500 for an authenticated guardian", async () => {
      const router = (await import("../../server/routes/guardian-routes"))
        .default;
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        (req as express.Request & { requestId?: string }).requestId =
          "wsgl-stage3";
        next();
      });
      app.use("/api/guardian", router);
      // Surface the real error instead of Express's empty 500 body.
      app.use(
        (
          err: Error,
          _rq: express.Request,
          rs: express.Response,
          _n: express.NextFunction,
        ) => {
          // eslint-disable-next-line no-console
          console.log(`[WS-GL §9 ERR] ${err?.stack ?? err}`);
          rs.status(500).json({ error: String(err?.message ?? err) });
        },
      );

      const res = await request(app)
        .post("/api/guardian/link")
        .send({ code: STUDENT_A_CODE });

      // Printed so the failing run carries its own evidence.
      // eslint-disable-next-line no-console
      console.log(
        `[WS-GL §9] POST /api/guardian/link → ${res.status} ${JSON.stringify(res.body)}`,
      );

      // The exit criterion is BOTH halves. A 503 from an unconfigured bucket is
      // also "not 500", so asserting the status alone would pass without the route
      // ever reaching its handler — the exact vacuous proof this phase must avoid.
      const ledger = await pg.query(
        `SELECT profile_id, bucket_key, used_count, limit_count, window_start, window_end
           FROM public.rate_limit_ledger ORDER BY bucket_key`,
      );
      // eslint-disable-next-line no-console
      console.log(
        `[WS-GL §9] rate_limit_ledger rows=${ledger.rowCount}: ${JSON.stringify(ledger.rows)}`,
      );

      expect(res.status).not.toBe(500);
      expect(ledger.rowCount).toBeGreaterThan(0);
      expect(ledger.rows[0].bucket_key).toBe("guardian_link_attempts_daily");
    }, 30_000);
  },
);
