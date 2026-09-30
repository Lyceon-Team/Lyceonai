/**
 * Guardian sign-up: the one-time role choice and the guardian age rule → real PostgreSQL.
 *
 * @spec [Guardian_Closure_Plan G1-02 named proof (1); owner rulings R1, R10] | @implemented [2026-09-29]
 *
 * plain English: drives the REAL `PATCH /api/profile` and `POST /api/guardian/link/redeem`
 * handlers against a REAL database with every migration applied. The six cases are the
 * row's named proof, in its order:
 *   1. guardian + adult DOB, before completion      → 200, role='guardian'
 *   2. guardian + under-18 DOB                      → 403, role unchanged
 *   3. any role change after completion             → 403, role unchanged
 *   4. admin                                        → 403
 *   5. an active link, or any learning state        → 403, role unchanged
 *   6. redeem by a guardian with no DOB / under 18  → 403, no link row
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (service-role clients → real SQL via
 * tests/helpers/pg-supabase) and the AUTH BOUNDARY. The auth fixture reads `role` from the
 * REAL profiles row on every request, as `supabaseAuthMiddleware` does in production, so a
 * role the PATCH wrote is the role the next request sees. Everything else runs for real.
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

const DB_NAME = "guardian_signup_ci";
const NEWCOMER = "a1111111-1111-4111-8111-111111111111";
const STUDENT = "a2222222-2222-4222-8222-222222222222";

let pg: Client;
const session = { id: NEWCOMER };

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
    getSupabaseAdmin: () => makePgSupabase(pg),
    requireSupabaseAuth: async (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      // Role comes from the real row, exactly as production's middleware reads it.
      const row = await pg.query(
        `SELECT role FROM public.profiles WHERE id = $1`,
        [session.id],
      );
      const role = row.rows[0]?.role as string;
      (req as express.Request & { user?: unknown }).user = {
        id: session.id,
        email: "person@example.test",
        role,
        isAdmin: role === "admin",
        isGuardian: role === "guardian",
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
  const { requireSupabaseAuth } =
    await import("../../server/middleware/supabase-auth");
  const profileRoutes = (await import("../../server/routes/profile-routes"))
    .default;
  const guardianRoutes = (await import("../../server/routes/guardian-routes"))
    .default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "g1-02";
    next();
  });
  app.use("/api/profile", requireSupabaseAuth, profileRoutes);
  app.use("/api/guardian", guardianRoutes);
  app.use(
    (
      err: Error,
      _rq: express.Request,
      rs: express.Response,
      _n: express.NextFunction,
    ) => {
      rs.status(500).json({ error: String(err?.message ?? err) });
    },
  );
  return app;
}

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function profile(id: string): Promise<{
  role: string;
  date_of_birth: string | null;
  profile_completed_at: string | null;
}> {
  const r = await pg.query(
    `SELECT role, date_of_birth::text AS date_of_birth, profile_completed_at::text AS profile_completed_at
       FROM public.profiles WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

async function linkRows(): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS c FROM public.guardian_links`,
  );
  return r.rows[0].c as number;
}

const asGuardian = (dateOfBirth: string | null) => ({
  displayName: "Pat Parent",
  role: "guardian",
  dateOfBirth,
});

describe.skipIf(!PG_AVAILABLE)("G1-02 guardian sign-up — real Postgres", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
    await pg.query(
      `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4)`,
      [NEWCOMER, "new@example.test", STUDENT, "s@example.test"],
    );
    await pg.query(
      `INSERT INTO public.profiles (id, email, role) VALUES ($1,$2,'student'),($3,$4,'student')`,
      [NEWCOMER, "new@example.test", STUDENT, "s@example.test"],
    );
  });

  afterAll(async () => {
    if (pg) await pg.end();
  });

  beforeEach(async () => {
    session.id = NEWCOMER;
    await pg.query(`DELETE FROM public.guardian_links`);
    await pg.query(`DELETE FROM public.notification_events`);
    await pg.query(`DELETE FROM public.rate_limit_ledger`);
    await pg.query(
      `DELETE FROM public.student_domain_mastery WHERE student_id = $1`,
      [NEWCOMER],
    );
    // Every account starts as the trigger leaves it: a student with nothing completed.
    // Two statements, in this order: G2-03's lock refuses a date-of-birth change on a COMPLETED
    // profile, so completion is undone first — exactly as it would have to be for real.
    await pg.query(
      `UPDATE public.profiles
          SET role = 'student', profile_completed_at = NULL,
              student_link_code = NULL, student_link_code_issued_at = NULL
        WHERE id = $1`,
      [NEWCOMER],
    );
    await pg.query(
      `UPDATE public.profiles SET date_of_birth = NULL WHERE id = $1`,
      [NEWCOMER],
    );
  });

  it("1. a new account completes as guardian with an adult date of birth → role='guardian'", async () => {
    const res = await request(await buildApp())
      .patch("/api/profile")
      .send(asGuardian(yearsAgo(40)));

    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe("guardian");
    const row = await profile(NEWCOMER);
    expect(row.role).toBe("guardian");
    expect(row.date_of_birth).not.toBeNull();
    expect(row.profile_completed_at).not.toBeNull();
  });

  it("2. guardian with an under-18 date of birth → 403 GUARDIAN_UNDER_18, role unchanged", async () => {
    const res = await request(await buildApp())
      .patch("/api/profile")
      .send(asGuardian(yearsAgo(16)));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("GUARDIAN_UNDER_18");
    expect((await profile(NEWCOMER)).role).toBe("student");
  });

  it("3. a role change after completion → 403 ROLE_LOCKED, role unchanged", async () => {
    await pg.query(
      `UPDATE public.profiles SET date_of_birth = $2, profile_completed_at = now() WHERE id = $1`,
      [NEWCOMER, yearsAgo(40)],
    );
    const res = await request(await buildApp())
      .patch("/api/profile")
      .send(asGuardian(yearsAgo(40)));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ROLE_LOCKED");
    expect((await profile(NEWCOMER)).role).toBe("student");
  });

  it("4. choosing admin → 403, role unchanged", async () => {
    const res = await request(await buildApp())
      .patch("/api/profile")
      .send({ displayName: "Eve", role: "admin", dateOfBirth: yearsAgo(40) });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ROLE_NOT_SELF_ASSIGNABLE");
    expect((await profile(NEWCOMER)).role).toBe("student");
  });

  it("5a. a profile with an active guardian link → 403 ROLE_CHANGE_BLOCKED", async () => {
    // NEWCOMER is the STUDENT side of an active link to another account.
    await pg.query(
      `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
       VALUES ($1, $2, 'active', 'student', now(), now())`,
      [STUDENT, NEWCOMER],
    );
    const res = await request(await buildApp())
      .patch("/api/profile")
      .send(asGuardian(yearsAgo(40)));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ROLE_CHANGE_BLOCKED");
    expect((await profile(NEWCOMER)).role).toBe("student");
  });

  it("5b. a profile with learning state → 403 ROLE_CHANGE_BLOCKED", async () => {
    await pg.query(
      `INSERT INTO public.student_domain_mastery (student_id, section, domain, constants_snapshot_hash)
       VALUES ($1, 'M', 'algebra', 'g1-02')`,
      [NEWCOMER],
    );
    const res = await request(await buildApp())
      .patch("/api/profile")
      .send(asGuardian(yearsAgo(40)));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ROLE_CHANGE_BLOCKED");
    expect((await profile(NEWCOMER)).role).toBe("student");
  });

  describe("6. redeem refuses a guardian with no date of birth, or under 18, and writes no link", () => {
    async function codeForStudent(): Promise<string> {
      const { issueStudentLinkCode } =
        await import("../../server/lib/student-link-code");
      const issued = await issueStudentLinkCode(STUDENT);
      expect(issued).not.toBeNull();
      return issued!.code;
    }

    it("no date of birth → 403 GUARDIAN_DATE_OF_BIRTH_REQUIRED, no link, code still live", async () => {
      await pg.query(
        `UPDATE public.profiles SET role='guardian', date_of_birth=NULL, profile_completed_at=now() WHERE id=$1`,
        [NEWCOMER],
      );
      const code = await codeForStudent();
      const res = await request(await buildApp())
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("GUARDIAN_DATE_OF_BIRTH_REQUIRED");
      expect(await linkRows()).toBe(0);
      const live = await pg.query(
        `SELECT student_link_code FROM public.profiles WHERE id=$1`,
        [STUDENT],
      );
      expect(live.rows[0].student_link_code).toBe(code);
    });

    it("under 18 → 403 GUARDIAN_UNDER_18, no link", async () => {
      await pg.query(
        `UPDATE public.profiles SET role='guardian', date_of_birth=$2, profile_completed_at=now() WHERE id=$1`,
        [NEWCOMER, yearsAgo(16)],
      );
      const code = await codeForStudent();
      const res = await request(await buildApp())
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("GUARDIAN_UNDER_18");
      expect(await linkRows()).toBe(0);
    });

    it("an existing guardian with no date of birth adds it once, then redeems", async () => {
      await pg.query(
        `UPDATE public.profiles SET role='guardian', date_of_birth=NULL, profile_completed_at=now() WHERE id=$1`,
        [NEWCOMER],
      );
      const app = await buildApp();

      const young = await request(app)
        .post("/api/profile/date-of-birth")
        .send({ dateOfBirth: yearsAgo(16) });
      expect(young.status).toBe(403);
      expect(young.body.error.code).toBe("GUARDIAN_UNDER_18");
      expect((await profile(NEWCOMER)).date_of_birth).toBeNull();

      const set = await request(app)
        .post("/api/profile/date-of-birth")
        .send({ dateOfBirth: yearsAgo(40) });
      expect(set.status).toBe(200);
      expect((await profile(NEWCOMER)).date_of_birth).not.toBeNull();

      // One time only: a second fill cannot overwrite it (G2-03 owns the general lock).
      const again = await request(app)
        .post("/api/profile/date-of-birth")
        .send({ dateOfBirth: yearsAgo(30) });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("DATE_OF_BIRTH_ALREADY_SET");

      const code = await codeForStudent();
      const res = await request(app)
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });
      expect(res.status).toBe(201);
      expect(await linkRows()).toBe(1);
    });

    it("control: an adult guardian redeems → 201 and one link", async () => {
      await pg.query(
        `UPDATE public.profiles SET role='guardian', date_of_birth=$2, profile_completed_at=now() WHERE id=$1`,
        [NEWCOMER, yearsAgo(40)],
      );
      const code = await codeForStudent();
      const res = await request(await buildApp())
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });

      expect(res.status).toBe(201);
      expect(await linkRows()).toBe(1);
    });
  });
});
