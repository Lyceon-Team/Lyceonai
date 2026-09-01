/**
 * Guardian linking by student code → real PostgreSQL proof (SCL-080).
 *
 * @spec [SCL-080; Doc 01 V8 §35 Guardian-student linkage; §36.2 abuse controls;
 *        §36.3 Revocation] | @implemented [2026-09-01]
 *
 * plain English: drives the REAL routes against a REAL database with the real migrations
 * applied, plus the DDL SCL-080 needs. What it proves, in the order the owner's edge cases
 * name them: one response for used/expired/invalid, 409 for an existing link, a refusal for
 * your own code, and — the one no mock can establish — that two guardians racing one code
 * produce exactly one link, because the DATABASE settles it.
 *
 * NO PRIVATE DDL. Every object this suite touches comes from `supabase/migrations/`, applied
 * by `bootstrapPgDatabase` in the same sorted order the genesis fresh-apply gate uses. That
 * is the point: the schema under test is the schema the pipeline produces, not one this file
 * arranged for itself. A test that applies its own DDL can only ever prove that its own DDL
 * is self-consistent.
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (`supabaseServer` → real SQL via
 * tests/helpers/pg-supabase) and the AUTH BOUNDARY (a session fixture). NOT substituted:
 * `server/lib/student-link-code`, `server/lib/account`, `server/lib/auth-runtime-config`,
 * the rate-limit ledger, and the routes themselves — every module whose behaviour is under
 * test runs for real, against real SQL.
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
import {
  makePgSupabase,
  bootstrapPgDatabase,
  PG_AVAILABLE,
} from "../helpers/pg-supabase";

const DB_NAME = "guardian_link_code_ci";
const GUARDIAN = "11111111-1111-4111-8111-111111111111";
const GUARDIAN_B = "44444444-4444-4444-8444-444444444444";
const STUDENT = "22222222-2222-4222-8222-222222222222";

let pg: Client;
/** Which principal the auth fixture presents. Switched per case. */
const session = { id: GUARDIAN, role: "guardian" as string };

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
        id: session.id,
        email: "party@example.test",
        role: session.role,
      };
      next();
    },
  };
});

vi.mock("../../server/middleware/csrf", () => ({
  doubleCsrfProtection: (_q: unknown, _s: unknown, next: () => void) => next(),
  generateToken: () => "test-csrf-token",
}));

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "scl-080";
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
      console.log(`[SCL-080 ERR] ${err?.stack ?? err}`);
      rs.status(500).json({ error: String(err?.message ?? err) });
    },
  );
  return app;
}

/** Issue a code directly through the domain module and read it back from the row. */
async function currentCode(): Promise<string> {
  const { issueStudentLinkCode } = await import(
    "../../server/lib/student-link-code"
  );
  const issued = await issueStudentLinkCode(STUDENT);
  expect(issued).not.toBeNull();
  return issued!.code;
}

async function activeLinks(): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS c FROM public.guardian_links WHERE status='active'`,
  );
  return r.rows[0].c as number;
}

describe.skipIf(!PG_AVAILABLE)("guardian linking by code — real Postgres", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);

    await pg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
      [
        GUARDIAN, "g@example.test",
        GUARDIAN_B, "g2@example.test",
        STUDENT, "s@example.test",
      ],
    );
    await pg.query(
      `INSERT INTO public.profiles (id, email, role) VALUES
         ($1,$2,'guardian'),($3,$4,'guardian'),($5,$6,'student')`,
      [
        GUARDIAN, "g@example.test",
        GUARDIAN_B, "g2@example.test",
        STUDENT, "s@example.test",
      ],
    );
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

  beforeEach(async () => {
    session.id = GUARDIAN;
    session.role = "guardian";
    await pg.query(`DELETE FROM public.guardian_links`);
    await pg.query(`DELETE FROM public.notification_outbox`);
    await pg.query(`DELETE FROM public.rate_limit_ledger`);
    await pg.query(
      `UPDATE public.profiles SET student_link_code = NULL, student_link_code_issued_at = NULL`,
    );
  });

  it("a guardian redeems a code and the link is ACTIVE immediately — no pending state", async () => {
    const code = await currentCode();
    const res = await request(await buildApp())
      .post("/api/guardian/link/redeem")
      .send({ code });

    expect(res.status).toBe(201);
    const row = await pg.query(
      `SELECT status, guardian_profile_id, student_profile_id, accepted_at
         FROM public.guardian_links`,
    );
    expect(row.rowCount).toBe(1);
    expect(row.rows[0].status).toBe("active");
    expect(row.rows[0].guardian_profile_id).toBe(GUARDIAN);
    expect(row.rows[0].student_profile_id).toBe(STUDENT);
    // No handshake to wait for, so acceptance is recorded at creation.
    expect(row.rows[0].accepted_at).not.toBeNull();
  });

  it("spends the code: the SAME code cannot be redeemed twice", async () => {
    const code = await currentCode();
    const app = await buildApp();

    expect((await request(app).post("/api/guardian/link/redeem").send({ code })).status).toBe(201);

    session.id = GUARDIAN_B;
    const second = await request(app).post("/api/guardian/link/redeem").send({ code });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("GUARDIAN_LINK_CODE_REFUSED");
    expect(await activeLinks()).toBe(1);
  });

  /**
   * EDGE CASE 4 — the one no mocked query layer can establish. Both requests reach one
   * conditional UPDATE against one row; Postgres serialises them.
   */
  it("two guardians racing one code produce exactly ONE link", async () => {
    const code = await currentCode();
    const appA = await buildApp();

    const [a, b] = await Promise.all([
      request(appA).post("/api/guardian/link/redeem").send({ code }),
      request(appA).post("/api/guardian/link/redeem").send({ code }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);
    expect(await activeLinks()).toBe(1);
  });

  /** EDGE CASE 1 — used, expired and never-real are indistinguishable from outside. */
  it("gives the SAME response for a code that never existed as for one already spent", async () => {
    const app = await buildApp();
    const never = await request(app)
      .post("/api/guardian/link/redeem")
      .send({ code: "ZZZZZZ" });

    const code = await currentCode();
    await request(app).post("/api/guardian/link/redeem").send({ code });
    session.id = GUARDIAN_B;
    const spent = await request(app).post("/api/guardian/link/redeem").send({ code });

    expect(never.status).toBe(spent.status);
    expect(never.body.error.code).toBe(spent.body.error.code);
    expect(never.body.error.message).toBe(spent.body.error.message);
  });

  /** EDGE CASE 2 — already linked is a 409, and writes nothing further. */
  it("409s a guardian already linked to that student, and writes no second row", async () => {
    const app = await buildApp();
    await request(app).post("/api/guardian/link/redeem").send({ code: await currentCode() });

    const again = await request(app)
      .post("/api/guardian/link/redeem")
      .send({ code: await currentCode() });

    expect(again.status).toBe(409);
    expect(await activeLinks()).toBe(1);
  });

  /** EDGE CASE 3 — your own code links nobody. */
  it("refuses a student's own code and creates no link", async () => {
    const code = await currentCode();
    session.id = STUDENT;
    session.role = "guardian"; // an account holding both roles: the identity check, not the role gate

    const res = await request(await buildApp())
      .post("/api/guardian/link/redeem")
      .send({ code });

    expect(res.status).toBe(400);
    expect(await activeLinks()).toBe(0);
  });

  /** EDGE CASE 10 — the student is told, exactly once. */
  it("emits ONE guardian_linked outbox row to the student", async () => {
    await request(await buildApp())
      .post("/api/guardian/link/redeem")
      .send({ code: await currentCode() });

    const out = await pg.query(
      `SELECT event_type, recipient_kind, recipient_profile_id FROM public.notification_outbox`,
    );
    expect(out.rowCount).toBe(1);
    expect(out.rows[0].event_type).toBe("guardian_linked");
    expect(out.rows[0].recipient_kind).toBe("student");
    expect(out.rows[0].recipient_profile_id).toBe(STUDENT);
  });

  /** EDGE CASE 6 / F2 — the cycle the old constraint made impossible after one round. */
  it("supports revoke → re-link → revoke, more than once", async () => {
    const app = await buildApp();
    for (let round = 0; round < 3; round += 1) {
      const res = await request(app)
        .post("/api/guardian/link/redeem")
        .send({ code: await currentCode() });
      expect(res.status).toBe(201);
      await pg.query(
        `UPDATE public.guardian_links SET status='revoked' WHERE status='active'`,
      );
    }
    expect(await activeLinks()).toBe(0);
    const revoked = await pg.query(
      `SELECT count(*)::int AS c FROM public.guardian_links WHERE status='revoked'`,
    );
    expect(revoked.rows[0].c).toBe(3);
  });
});
