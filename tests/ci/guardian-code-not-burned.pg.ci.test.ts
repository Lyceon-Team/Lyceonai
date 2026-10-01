/**
 * A redeem that creates no link leaves the student's code redeemable → real PostgreSQL.
 *
 * @spec [Guardian_Closure_Plan G1-06 named proof; audit G-AUD-13; SCL-080 (single-use code)]
 * | @implemented [2026-09-29]
 *
 * plain English: spending the code (one conditional UPDATE on `profiles`) and writing the link
 * (`create_active_guardian_link_audited`) are separate transactions. When the link write
 * failed — most visibly LY004, "already linked" — the code had already been rotated away, so
 * the student had to hand a NEW code to anyone else. A redeem that produces no link must not
 * cost the student their code.
 *
 * MOCK BOUNDARY. Real routes, real SQL, real migrations. The link writer is passed through to
 * the real one, except in the last case, which forces ONE infrastructure failure after the
 * spend to prove the compensation path.
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

const DB_NAME = "guardian_code_not_burned_ci";
const GUARDIAN = "e1111111-1111-4111-8111-111111111111";
const GUARDIAN_B = "e4444444-4444-4444-8444-444444444444";
const STUDENT = "e2222222-2222-4222-8222-222222222222";

let pg: Client;
const session = { id: GUARDIAN };
const failure = { nextCreate: false };

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

vi.mock("../../server/lib/account", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../server/lib/account")>();
  return {
    ...actual,
    createActiveGuardianLink: async (
      ...args: Parameters<typeof actual.createActiveGuardianLink>
    ) => {
      if (failure.nextCreate) {
        failure.nextCreate = false;
        throw new Error("connection reset while writing the link");
      }
      return actual.createActiveGuardianLink(...args);
    },
  };
});

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
        email: "g@example.test",
        role: "guardian",
      };
      next();
    },
  };
});

async function buildApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/guardian-routes")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { requestId?: string }).requestId = "g1-06";
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
      rs.status(500).json({ error: String(err?.message ?? err) });
    },
  );
  return app;
}

async function issueCode(): Promise<string> {
  const { issueStudentLinkCode } =
    await import("../../server/lib/student-link-code");
  const issued = await issueStudentLinkCode(STUDENT);
  expect(issued).not.toBeNull();
  return issued!.code;
}

async function studentCode(): Promise<string | null> {
  const r = await pg.query(
    `SELECT student_link_code FROM public.profiles WHERE id = $1`,
    [STUDENT],
  );
  return r.rows[0].student_link_code as string | null;
}

async function activeLinks(): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS c FROM public.guardian_links WHERE status = 'active'`,
  );
  return r.rows[0].c as number;
}

describe.skipIf(!PG_AVAILABLE)(
  "G1-06 a failed redeem does not burn the code",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6)`,
        [
          GUARDIAN,
          "g@example.test",
          GUARDIAN_B,
          "g2@example.test",
          STUDENT,
          "s@example.test",
        ],
      );
      // Adult dates of birth on the guardians: G1-02 (R10) refuses a redeem without one.
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, date_of_birth) VALUES
         ($1,$2,'guardian','1980-01-01'),($3,$4,'guardian','1980-01-01'),($5,$6,'student','2010-01-01')`,
        [
          GUARDIAN,
          "g@example.test",
          GUARDIAN_B,
          "g2@example.test",
          STUDENT,
          "s@example.test",
        ],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      session.id = GUARDIAN;
      failure.nextCreate = false;
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      await pg.query(
        `UPDATE public.profiles SET student_link_code = NULL, student_link_code_issued_at = NULL`,
      );
    });

    it("with a pre-existing active link: redeem returns 409 and the SAME code is still redeemable", async () => {
      await pg.query(
        `INSERT INTO public.guardian_links (guardian_profile_id, student_profile_id, status, initiated_by, initiated_at, accepted_at)
       VALUES ($1, $2, 'active', 'student', now(), now())`,
        [GUARDIAN, STUDENT],
      );
      const code = await issueCode();
      const app = await buildApp();

      const res = await request(app)
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("GUARDIAN_LINK_ALREADY_EXISTS");

      // Not rotated...
      expect(await studentCode()).toBe(code);
      // ...and genuinely redeemable: another guardian uses it.
      session.id = GUARDIAN_B;
      const second = await request(app)
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });
      expect(second.status).toBe(201);
      expect(await activeLinks()).toBe(2);
    });

    it("an infrastructure failure writing the link restores the code", async () => {
      const code = await issueCode();
      const app = await buildApp();
      failure.nextCreate = true;

      const res = await request(app)
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });
      expect(res.status).toBe(500);
      expect(await activeLinks()).toBe(0);
      expect(await studentCode()).toBe(code);

      const retry = await request(app)
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });
      expect(retry.status).toBe(201);
      expect(await activeLinks()).toBe(1);
    });

    it("control: a successful redeem still spends the code (single use)", async () => {
      const code = await issueCode();
      const res = await request(await buildApp())
        .post("/api/guardian/link/redeem")
        .send({ code, acceptParentGuardianTerms: true });
      expect(res.status).toBe(201);
      expect(await studentCode()).not.toBe(code);
    });
  },
);
