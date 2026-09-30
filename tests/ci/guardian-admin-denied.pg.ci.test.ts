/**
 * Guardian routes admit guardians only; the link function checks both parties' roles.
 *
 * @spec [Guardian_Closure_Plan G2-01; audit G-AUD-05; owner ruling R5 (2026-09-27); SCL-078]
 *       | @implemented [2026-09-29]
 *
 * plain English: an admin session is refused on every `/api/guardian/*` route with the
 * guardian gate's own 403, and a redeem by an admin spends nothing and links nothing. Below
 * the route, `create_active_guardian_link_audited` refuses (LY006) any grantee that is not a
 * guardian and any subject that is not a student, so a future caller that skips the route gate
 * still cannot write a link between the wrong kinds of account.
 *
 * WHY THE ADMIN HAS AN ADULT DATE OF BIRTH. Redeem also refuses a caller with no date of birth
 * (G1-02). Without one, the admin would be refused by that check instead, and this file would
 * pass against the old gate for the wrong reason. With it, the only thing between an admin and
 * a link is the role gate — which is the thing under test.
 *
 * MOCK BOUNDARY. Substituted: the DATABASE TRANSPORT (`supabaseServer` → real SQL over genesis +
 * every migration) and the AUTH BOUNDARY (the session reads the caller's real `profiles` row).
 * The router, the role gate, the code spend and the link function all run for real.
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

const DB_NAME = "guardian_admin_denied_ci";
const GUARDIAN = "e1111111-1111-4111-8111-111111111111";
const GUARDIAN_B = "e4444444-4444-4444-8444-444444444444";
const ADMIN = "e3333333-3333-4333-8333-333333333333";
const STUDENT = "e2222222-2222-4222-8222-222222222222";
const STUDENT_B = "e5555555-5555-4555-8555-555555555555";

let pg: Client;
/** Which principal the session presents. Switched per case; read back from `profiles`. */
const session = { id: GUARDIAN };

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
    requireSupabaseAuth: async (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      try {
        const r = await pg.query(
          `SELECT id, email, role::text AS role FROM public.profiles WHERE id = $1`,
          [session.id],
        );
        const p = r.rows[0];
        if (p) {
          (req as express.Request & { user?: unknown }).user = {
            id: p.id,
            email: p.email,
            role: p.role,
            isGuardian: p.role === "guardian",
            isAdmin: p.role === "admin",
          };
        }
        next();
      } catch (err) {
        next(err);
      }
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
    (req as express.Request & { requestId?: string }).requestId = "g2-01";
    next();
  });
  app.use("/api/guardian", router);
  return app;
}

async function liveCode(): Promise<string> {
  const { issueStudentLinkCode } =
    await import("../../server/lib/student-link-code");
  const issued = await issueStudentLinkCode(STUDENT);
  expect(issued).not.toBeNull();
  return issued!.code;
}

async function linkRows(): Promise<number> {
  const r = await pg.query(
    `SELECT count(*)::int AS c FROM public.guardian_links`,
  );
  return r.rows[0].c as number;
}

async function storedCode(): Promise<string | null> {
  const r = await pg.query(
    `SELECT student_link_code FROM public.profiles WHERE id = $1`,
    [STUDENT],
  );
  return (r.rows[0]?.student_link_code as string | null) ?? null;
}

describe.skipIf(!PG_AVAILABLE)(
  "G2-01 guardian routes admit guardians only — real Postgres",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase(DB_NAME);
      await pg.query(
        `INSERT INTO auth.users (id, email) VALUES ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)`,
        [
          GUARDIAN,
          "g@example.test",
          GUARDIAN_B,
          "g2@example.test",
          ADMIN,
          "a@example.test",
          STUDENT,
          "s@example.test",
          STUDENT_B,
          "s2@example.test",
        ],
      );
      await pg.query(
        `INSERT INTO public.profiles (id, email, role, date_of_birth) VALUES
         ($1,$2,'guardian',DATE '1980-01-01'),
         ($3,$4,'guardian',DATE '1981-01-01'),
         ($5,$6,'admin',   DATE '1979-01-01'),
         ($7,$8,'student', NULL),
         ($9,$10,'student', NULL)`,
        [
          GUARDIAN,
          "g@example.test",
          GUARDIAN_B,
          "g2@example.test",
          ADMIN,
          "a@example.test",
          STUDENT,
          "s@example.test",
          STUDENT_B,
          "s2@example.test",
        ],
      );
    });

    afterAll(async () => {
      if (pg) await pg.end();
    });

    beforeEach(async () => {
      session.id = GUARDIAN;
      await pg.query(`DELETE FROM public.guardian_links`);
      await pg.query(`DELETE FROM public.notification_events`);
      await pg.query(`DELETE FROM public.rate_limit_ledger`);
      await pg.query(
        `UPDATE public.profiles SET student_link_code = NULL, student_link_code_issued_at = NULL`,
      );
    });

    describe("route gate", () => {
      it("presence: a guardian redeeming a live code gets 201 and one link", async () => {
        const code = await liveCode();
        const res = await request(await buildApp())
          .post("/api/guardian/link/redeem")
          .send({ code, acceptParentGuardianTerms: true });
        expect(res.status).toBe(201);
        expect(await linkRows()).toBe(1);
      });

      it("an admin redeeming a live code gets the guardian gate's 403; nothing is linked or spent", async () => {
        const code = await liveCode();
        session.id = ADMIN;
        const res = await request(await buildApp())
          .post("/api/guardian/link/redeem")
          .send({ code, acceptParentGuardianTerms: true });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Guardian role required");
        expect(await linkRows()).toBe(0);
        // Refused before any code lookup: the student's code is exactly as issued.
        expect(await storedCode()).toBe(code);
      });

      it("an admin reading the guardian roster gets 403", async () => {
        session.id = ADMIN;
        const res = await request(await buildApp()).get(
          "/api/guardian/students",
        );
        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Guardian role required");
      });

      it("an admin unlinking a student gets 403, and the link survives", async () => {
        const code = await liveCode();
        const made = await request(await buildApp())
          .post("/api/guardian/link/redeem")
          .send({ code, acceptParentGuardianTerms: true });
        expect(made.status).toBe(201);
        session.id = ADMIN;
        const res = await request(await buildApp()).delete(
          `/api/guardian/link/${STUDENT}`,
        );
        expect(res.status).toBe(403);
        const active = await pg.query(
          `SELECT count(*)::int AS c FROM public.guardian_links WHERE status='active'`,
        );
        expect(active.rows[0].c).toBe(1);
      });
    });

    describe("create_active_guardian_link_audited checks both parties' roles", () => {
      const call = (grantee: string, subject: string) =>
        pg.query(
          `SELECT id FROM public.create_active_guardian_link_audited($1::uuid, $2::uuid, 'g2-01')`,
          [grantee, subject],
        );

      it("presence: guardian → student links", async () => {
        await expect(call(GUARDIAN, STUDENT)).resolves.toMatchObject({
          rowCount: 1,
        });
        expect(await linkRows()).toBe(1);
      });

      it("an admin grantee is refused (LY006) and writes nothing", async () => {
        await expect(call(ADMIN, STUDENT)).rejects.toMatchObject({
          code: "LY006",
        });
        expect(await linkRows()).toBe(0);
      });

      it("a student grantee is refused (LY006)", async () => {
        await expect(call(STUDENT_B, STUDENT)).rejects.toMatchObject({
          code: "LY006",
        });
        expect(await linkRows()).toBe(0);
      });

      it("a subject that is not a student is refused (LY006)", async () => {
        await expect(call(GUARDIAN, GUARDIAN_B)).rejects.toMatchObject({
          code: "LY006",
        });
        await expect(call(GUARDIAN, ADMIN)).rejects.toMatchObject({
          code: "LY006",
        });
        expect(await linkRows()).toBe(0);
      });

      it("a grantee with no profile is refused (LY006)", async () => {
        await expect(
          call("e9999999-9999-4999-8999-999999999999", STUDENT),
        ).rejects.toMatchObject({ code: "LY006" });
      });
    });
  },
);
